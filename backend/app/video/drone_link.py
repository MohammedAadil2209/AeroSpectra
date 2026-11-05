"""Direct Wi-Fi link to cooingdv / "RC UFO" family drones (E88 Pro clones, e.g. Elilvendan B2).

Protocol facts (cross-checked against public reverse-engineering notes: Buff220/e88pro-reverse-RC-FPV-,
Juliii-p/e88-drone-pc-control (MIT), PatrickAcheson/E99-drone-reverse-engineer, turbodrone `cooingdv`):
  * The drone is a Wi-Fi access point, normally 192.168.1.1 (SSID WIFI-UFO-xxxx / FLY-UFO-xxxx).
  * Keep-alive heartbeat: UDP 0x01 0x01 -> <ip>:7099 every 1 s. The RTSP server only streams while port 7099
    sees traffic. The drone answers on the same socket ~1x/s with ~5 bytes:
    byte0 = module id (e.g. 83), byte1 = camera-switch mode (1 = hot switch, 2 = RTSP must be reopened).
  * Video: rtsp://<ip>:7070/webcam, RTP over UDP (MJPEG, low resolution); TCP interleaved as a fallback.
  * Camera select: 0x06 0x01 = front lens, 0x06 0x02 = bottom lens.
  * Only one client at a time - the RC UFO phone app must be closed.

SAFETY: this module never sends flight-control or "stop" (0x08 0x01) packets. Fly with the physical remote.
"""
from __future__ import annotations

import ipaddress
import logging
import os
import re
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2

log = logging.getLogger("aerospectra.drone")

DEFAULT_IP = "192.168.1.1"
CTRL_PORT = 7099
RTSP_PORT = 7070
RTSP_PATH = "/webcam"
HEARTBEAT = bytes([0x01, 0x01])
CAMERA_CMD = {"front": bytes([0x06, 0x01]), "bottom": bytes([0x06, 0x02])}
_FFMPEG_ENV_LOCK = threading.Lock()


class DroneError(RuntimeError):
    """Raised with a human-readable reason (wrong Wi-Fi, firewall, app still connected, no RTSP...)."""


# ------------------------------------------------------------------ IP detection
def parse_ipconfig_gateways(text: str) -> List[Tuple[str, str]]:
    """Parse Windows `ipconfig` output -> [(adapter_name, ipv4_gateway)] in order."""
    out: List[Tuple[str, str]] = []
    adapter = ""
    pending_gateway = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line and not line.startswith(" ") and line.endswith(":"):
            adapter = line[:-1].strip()
            pending_gateway = False
            continue
        if "Default Gateway" in line:
            vals = re.findall(r"(\d{1,3}(?:\.\d{1,3}){3})", line)
            if vals:
                out.append((adapter, vals[0]))
                pending_gateway = False
            else:
                pending_gateway = True  # IPv6 first, IPv4 on the next line
            continue
        if pending_gateway:
            vals = re.findall(r"^\s+(\d{1,3}(?:\.\d{1,3}){3})\s*$", line)
            if vals:
                out.append((adapter, vals[0]))
            pending_gateway = False
    return out


def looks_like_home_router(ip: str) -> bool:
    """True for typical home/office router ranges the drone never uses (192.168.0.x, 10.x)."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return ip.startswith("192.168.0.") or a in ipaddress.ip_network("10.0.0.0/8")


def detect_drone_ip(preferred: Optional[str] = None, ipconfig_text: Optional[str] = None) -> dict:
    """Pick the drone IP: explicit > 192.168.1.1 if it is a current gateway > Wi-Fi default gateway > default."""
    warnings: List[str] = []
    if preferred and preferred.strip() and preferred.strip().lower() != "auto":
        ip = preferred.strip()
        src = "configured"
        gateways: List[Tuple[str, str]] = []
    else:
        if ipconfig_text is None:
            ipconfig_text = _run_ipconfig()
        gateways = parse_ipconfig_gateways(ipconfig_text)
        gw_ips = [g for _, g in gateways]
        wifi = [g for name, g in gateways if re.search(r"wi-?fi|wireless|wlan", name, re.I)]
        if DEFAULT_IP in gw_ips:
            ip, src = DEFAULT_IP, "default (gateway match)"
        elif wifi:
            ip, src = wifi[0], "Wi-Fi default gateway"
        elif gw_ips:
            ip, src = gw_ips[0], "default gateway"
        else:
            ip, src = DEFAULT_IP, "default (no gateway found)"
            warnings.append("No default gateway found - is this laptop connected to the drone's Wi-Fi (WIFI-UFO-... / FLY-UFO-...)?")
    if looks_like_home_router(ip):
        warnings.append(f"{ip} looks like a home/office router, not the drone. Connect the laptop Wi-Fi to the drone's network.")
    return {"ip": ip, "source": src, "gateways": [{"adapter": a, "gateway": g} for a, g in gateways], "warnings": warnings}


def _run_ipconfig() -> str:
    if os.name != "nt":
        try:
            return subprocess.run(["ip", "route"], capture_output=True, text=True, timeout=3).stdout.replace("default via", "Default Gateway . . : ")
        except Exception:  # noqa: BLE001
            return ""
    try:
        return subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=4,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except Exception:  # noqa: BLE001
        return ""


def tcp_port_open(ip: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


# ------------------------------------------------------------------ link
@dataclass
class LinkStats:
    sent: int = 0
    replies: int = 0
    last_reply_at: float = 0.0
    last_reply: bytes = b""
    module_id: Optional[int] = None
    switch_mode: Optional[int] = None
    errors: List[str] = field(default_factory=list)


class DroneLink:
    """UDP heartbeat + RTSP capture helper for one drone."""

    def __init__(self, ip: Optional[str] = None, ctrl_port: int = CTRL_PORT, rtsp_port: int = RTSP_PORT,
                 interval: float = 1.0) -> None:
        det = detect_drone_ip(ip)
        self.ip: str = det["ip"]
        self.ip_source: str = det["source"]
        self.warnings: List[str] = list(det["warnings"])
        self.ctrl_port = ctrl_port
        self.rtsp_port = rtsp_port
        self.interval = interval
        self.stats = LinkStats()
        self.lens = "front"
        self._sock: Optional[socket.socket] = None
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        self.transport = ""
        self.rtsp_reachable: Optional[bool] = None
        self.width = 0
        self.height = 0
        self.fps = 0.0

    # ---------------- heartbeat
    @property
    def rtsp_url(self) -> str:
        return f"rtsp://{self.ip}:{self.rtsp_port}{RTSP_PATH}"

    @property
    def alive(self) -> bool:
        """Drone answered within the last 3 s."""
        return self.stats.last_reply_at > 0 and time.monotonic() - self.stats.last_reply_at < 3.0

    @property
    def running(self) -> bool:
        return self._sock is not None and not self._stop.is_set()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(("0.0.0.0", 0))
        s.settimeout(0.5)
        self._sock = s
        self._threads = [
            threading.Thread(target=self._heartbeat_loop, name="drone-heartbeat", daemon=True),
            threading.Thread(target=self._recv_loop, name="drone-rx", daemon=True),
        ]
        for t in self._threads:
            t.start()
        log.info("drone heartbeat started -> %s:%d (every %.1fs)", self.ip, self.ctrl_port, self.interval)

    def stop(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=1.5)
        self._threads = []
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        log.info("drone heartbeat stopped")

    def restart(self) -> None:
        self.stop()
        self.start()

    def send(self, payload: bytes) -> bool:
        s = self._sock
        if s is None:
            return False
        try:
            s.sendto(payload, (self.ip, self.ctrl_port))
            return True
        except OSError as e:  # e.g. network unreachable when not on the drone Wi-Fi
            msg = f"send failed: {e}"
            if not self.stats.errors or self.stats.errors[-1] != msg:
                self.stats.errors = (self.stats.errors + [msg])[-5:]
            return False

    def _heartbeat_loop(self) -> None:
        while not self._stop.is_set():
            if self.send(HEARTBEAT):
                self.stats.sent += 1
            self._stop.wait(self.interval)

    def _recv_loop(self) -> None:
        while not self._stop.is_set():
            s = self._sock
            if s is None:
                return
            try:
                data, addr = s.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                if self._stop.is_set():
                    return
                time.sleep(0.2)
                continue
            if not data:
                continue
            first = self.stats.replies == 0
            self.stats.replies += 1
            self.stats.last_reply_at = time.monotonic()
            self.stats.last_reply = data[:32]
            self.stats.module_id = data[0]
            if len(data) > 1:
                self.stats.switch_mode = data[1]
            if first:
                log.info("drone %s replied on %d: %s (module id %s)", addr[0], self.ctrl_port, data[:16].hex(" "), data[0])

    def wait_for_reply(self, timeout: float) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.stats.replies:
                return True
            time.sleep(0.05)
        return bool(self.stats.replies)

    # ---------------- camera select
    def switch_camera(self, lens: str) -> bool:
        """Send the lens-select command. Returns True when the RTSP stream should be reopened."""
        if lens not in CAMERA_CMD:
            raise ValueError("lens must be 'front' or 'bottom'")
        if not self.running:
            self.start()
        for _ in range(3):  # UDP: send a few times
            self.send(CAMERA_CMD[lens])
            time.sleep(0.05)
        self.lens = lens
        # switch mode 1 = hot switch; 2 (or unknown) = restart the RTSP stream
        return self.stats.switch_mode != 1

    # ---------------- RTSP
    def open_capture(self, timeout_ms: int = 2500, transports: Tuple[str, ...] = ("udp", "tcp")) -> Tuple[cv2.VideoCapture, dict]:
        """Open the RTSP stream (UDP first, TCP fallback). Raises DroneError with a clear reason."""
        self.rtsp_reachable = tcp_port_open(self.ip, self.rtsp_port, timeout=1.5)
        if not self.rtsp_reachable:
            raise DroneError(self._diagnose(rtsp_reachable=False))
        tried = []
        for transport in transports:
            with _FFMPEG_ENV_LOCK:  # the FFmpeg options env var is process-global
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                    f"rtsp_transport;{transport}|stimeout;5000000|timeout;5000000|fflags;nobuffer|flags;low_delay|max_delay;200000"
                )
                cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG,
                                       [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms])
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:  # noqa: BLE001
                pass
            ok, frame = (cap.read() if cap.isOpened() else (False, None))
            if ok and frame is not None:
                self.transport = transport
                self.height, self.width = frame.shape[:2]
                fps = cap.get(cv2.CAP_PROP_FPS)
                self.fps = float(fps) if 1 <= fps <= 120 else 20.0
                log.info("drone RTSP %s open over %s: %dx%d @ %.1f fps", self.rtsp_url, transport.upper(), self.width, self.height, self.fps)
                return cap, {"transport": transport, "width": self.width, "height": self.height, "fps": round(self.fps, 1), "frame": frame}
            cap.release()
            tried.append(transport.upper())
            log.info("drone RTSP over %s gave no frames", transport.upper())
        raise DroneError(self._diagnose(rtsp_reachable=True, tried=tried))

    def _diagnose(self, rtsp_reachable: bool, tried: Optional[List[str]] = None) -> str:
        hint = []
        if not rtsp_reachable:
            hint.append(f"RTSP port {self.ip}:{self.rtsp_port} is not reachable.")
            if self.stats.errors:
                hint.append(f"Network error: {self.stats.errors[-1]}.")
            hint.append("Check: laptop Wi-Fi is connected to the drone (WIFI-UFO-... / FLY-UFO-...), the drone is powered on, "
                        "and the IP is right.")
        else:
            hint.append(f"RTSP port open but no video over {' and '.join(tried or [])}.")
            if not self.stats.replies:
                hint.append("No heartbeat replies on UDP 7099 either.")
            hint.append("Likely causes: the RC UFO app is still connected on a phone (one client only - close it), or Windows "
                        "Firewall blocks inbound UDP for python.exe on Public networks (run tools\\allow_firewall.ps1 as admin).")
        hint.extend(self.warnings)
        return " ".join(hint)

    def status(self) -> dict:
        st = self.stats
        return {
            "ip": self.ip,
            "ip_source": self.ip_source,
            "rtsp_url": self.rtsp_url,
            "heartbeat_running": self.running,
            "heartbeats_sent": st.sent,
            "heartbeat_replies": st.replies,
            "alive": self.alive,
            "last_reply_age_s": round(time.monotonic() - st.last_reply_at, 1) if st.last_reply_at else None,
            "last_reply_hex": st.last_reply.hex(" ") if st.last_reply else "",
            "module_id": st.module_id,
            "switch_mode": st.switch_mode,
            "lens": self.lens,
            "rtsp_reachable": self.rtsp_reachable,
            "transport": self.transport,
            "width": self.width,
            "height": self.height,
            "fps": round(self.fps, 1),
            "warnings": self.warnings,
            "errors": st.errors[-3:],
        }


def probe(ip: Optional[str] = None, budget_s: float = 8.0) -> dict:
    """Heartbeat + grab one frame within `budget_s`. Never raises; returns ok/message/info (+ frame)."""
    t0 = time.monotonic()
    link = DroneLink(ip)
    link.start()
    res: dict = {"ok": False, "frame": None}
    try:
        link.wait_for_reply(1.2)
        remaining_ms = int(max(1000, (budget_s - (time.monotonic() - t0) - 2.0) * 1000 / 2))
        cap, info = link.open_capture(timeout_ms=min(2500, remaining_ms))
        cap.release()
        res.update(ok=True, frame=info.pop("frame"), message=f"Receiving video {info['width']}x{info['height']} over RTSP/{info['transport'].upper()}.")
    except DroneError as e:
        res["message"] = str(e)
    except Exception as e:  # noqa: BLE001
        res["message"] = f"Unexpected error: {e}"
    finally:
        link.stop()  # single client: release the drone before returning
        res.update(link.status())
        res["elapsed_s"] = round(time.monotonic() - t0, 2)
    return res
