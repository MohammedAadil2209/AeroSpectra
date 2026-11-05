"""Direct-drone link: packets, IP detection, heartbeat round-trip, graceful failure without a drone."""
from __future__ import annotations

import socket
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.video import drone_link as dl  # noqa: E402

IPCONFIG_DRONE = """
Windows IP Configuration


Ethernet adapter Ethernet:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . :

Wireless LAN adapter Wi-Fi:

   Connection-specific DNS Suffix  . :
   Link-local IPv6 Address . . . . . : fe80::1c2a:3b4c:5d6e:7f80%12
   IPv4 Address. . . . . . . . . . . : 192.168.1.100
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : fe80::1%12
                                       192.168.1.1
"""

IPCONFIG_OTHER_GW = """
Wireless LAN adapter Wi-Fi:

   IPv4 Address. . . . . . . . . . . : 172.16.10.5
   Default Gateway . . . . . . . . . : 172.16.10.1
"""

IPCONFIG_HOME = """
Ethernet adapter Ethernet 2:

   Default Gateway . . . . . . . . . : 10.0.0.1

Wireless LAN adapter Wi-Fi:

   Default Gateway . . . . . . . . . : 192.168.0.1
"""


def test_packets_match_protocol():
    assert dl.HEARTBEAT == b"\x01\x01"
    assert dl.CAMERA_CMD["front"] == b"\x06\x01"
    assert dl.CAMERA_CMD["bottom"] == b"\x06\x02"
    assert dl.CTRL_PORT == 7099 and dl.RTSP_PORT == 7070


def test_parse_ipconfig_ipv6_then_ipv4_gateway():
    assert dl.parse_ipconfig_gateways(IPCONFIG_DRONE) == [("Wireless LAN adapter Wi-Fi", "192.168.1.1")]


def test_detect_prefers_drone_default_ip():
    d = dl.detect_drone_ip(None, IPCONFIG_DRONE)
    assert d["ip"] == "192.168.1.1" and not d["warnings"]


def test_detect_falls_back_to_wifi_gateway():
    d = dl.detect_drone_ip(None, IPCONFIG_OTHER_GW)
    assert d["ip"] == "172.16.10.1" and d["source"] == "Wi-Fi default gateway"


def test_detect_warns_on_home_router():
    d = dl.detect_drone_ip(None, IPCONFIG_HOME)
    assert d["ip"] == "192.168.0.1"
    assert any("home/office router" in w for w in d["warnings"])


def test_detect_no_gateway_defaults_with_warning():
    d = dl.detect_drone_ip(None, "Windows IP Configuration\n")
    assert d["ip"] == dl.DEFAULT_IP and d["warnings"]


def test_explicit_ip_wins():
    assert dl.detect_drone_ip("192.168.1.10", IPCONFIG_HOME)["ip"] == "192.168.1.10"
    assert dl.detect_drone_ip("auto", IPCONFIG_DRONE)["ip"] == "192.168.1.1"


def test_home_router_heuristic():
    assert dl.looks_like_home_router("192.168.0.1")
    assert dl.looks_like_home_router("10.1.2.3")
    assert not dl.looks_like_home_router("192.168.1.1")
    assert not dl.looks_like_home_router("not-an-ip")


class FakeDrone:
    """Local UDP endpoint that records packets and answers like the drone (5 bytes, module id 83)."""

    def __init__(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.2)
        self.port = self.sock.getsockname()[1]
        self.packets: list = []
        self._stop = threading.Event()
        self.t = threading.Thread(target=self._run, daemon=True)
        self.t.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                data, addr = self.sock.recvfrom(64)
            except socket.timeout:
                continue
            except OSError:
                return
            self.packets.append(data)
            if data == dl.HEARTBEAT:
                self.sock.sendto(bytes([83, 2, 0, 0, 0]), addr)

    def close(self):
        self._stop.set()
        self.t.join(1)
        self.sock.close()


def test_heartbeat_round_trip_and_camera_switch():
    fake = FakeDrone()
    link = dl.DroneLink("127.0.0.1", ctrl_port=fake.port, interval=0.1)
    try:
        link.start()
        assert link.wait_for_reply(2.0)
        time.sleep(0.35)
        assert fake.packets.count(dl.HEARTBEAT) >= 3  # sent repeatedly at the configured interval
        st = link.status()
        assert st["heartbeat_replies"] >= 1 and st["alive"] and st["module_id"] == 83 and st["switch_mode"] == 2
        assert link.switch_camera("bottom") is True  # switch mode 2 -> stream must be reopened
        time.sleep(0.2)
        assert dl.CAMERA_CMD["bottom"] in fake.packets
        with pytest.raises(ValueError):
            link.switch_camera("rear")
    finally:
        link.stop()
        fake.close()
    sent = len(fake.packets)
    time.sleep(0.35)
    assert len(fake.packets) == sent  # heartbeat really stopped


def test_no_flight_or_stop_packets_ever_sent():
    fake = FakeDrone()
    link = dl.DroneLink("127.0.0.1", ctrl_port=fake.port, interval=0.05)
    try:
        link.start()
        link.switch_camera("front")
        time.sleep(0.3)
    finally:
        link.stop()
        fake.close()
    assert all(p in (dl.HEARTBEAT, dl.CAMERA_CMD["front"]) for p in fake.packets)
    assert b"\x08\x01" not in fake.packets


def test_probe_without_drone_fails_fast_with_reason():
    t0 = time.monotonic()
    res = dl.probe("127.0.0.1", budget_s=8.0)  # nothing listens on 127.0.0.1:7070
    assert time.monotonic() - t0 < 8.0
    assert res["ok"] is False and res["rtsp_reachable"] is False
    assert "not reachable" in res["message"] and "Wi-Fi" in res["message"]
    assert res["heartbeat_running"] is False  # cleaned up


class _FakeCap:
    """Delivers numbered frames, then goes silent (stream drop) after `limit` frames."""

    def __init__(self, start: int, limit: int) -> None:
        self.n = start
        self.left = limit

    def read(self):
        import numpy as np

        time.sleep(0.005)
        if self.left <= 0:
            time.sleep(0.05)
            return False, None
        self.left -= 1
        self.n += 1
        return True, np.full((4, 4, 3), self.n % 255, dtype=np.uint8)

    def release(self):
        pass


def test_drone_source_reconnects_and_serves_newest_frame(monkeypatch):
    from app.video.sources import DroneDirectSource

    caps = [_FakeCap(0, 40), _FakeCap(100, 10_000)]
    calls = {"restart": 0, "open": 0}

    def fake_open(self, timeout_ms=2500, transports=("udp", "tcp")):
        calls["open"] += 1
        cap = caps.pop(0)
        ok, frame = cap.read()
        return cap, {"transport": "udp", "width": 4, "height": 4, "fps": 25.0, "frame": frame}

    monkeypatch.setattr(dl.DroneLink, "open_capture", fake_open)
    monkeypatch.setattr(dl.DroneLink, "start", lambda self: None)
    monkeypatch.setattr(dl.DroneLink, "stop", lambda self: None)
    monkeypatch.setattr(dl.DroneLink, "wait_for_reply", lambda self, t: True)
    monkeypatch.setattr(dl.DroneLink, "restart", lambda self: calls.__setitem__("restart", calls["restart"] + 1))
    monkeypatch.setattr(DroneDirectSource, "STALL_S", 0.3)

    src = DroneDirectSource("127.0.0.1")
    src.open()
    try:
        saw_disconnect = False
        t0 = time.monotonic()
        while time.monotonic() - t0 < 5:
            if not src.connected:
                saw_disconnect = True
            if saw_disconnect and src.connected and src.reconnects == 1:
                break
            time.sleep(0.02)
        assert saw_disconnect, "source never reported the stall (Reconnecting...)"
        assert src.connected and src.reconnects == 1 and calls["restart"] == 1 and calls["open"] == 2
        # newest frame only: after a pause, read() returns the latest frame, not a backlog
        time.sleep(0.3)
        ok, f1 = src.read()
        time.sleep(0.3)
        ok2, f2 = src.read()
        assert ok and ok2 and int(f2[0, 0, 0]) - int(f1[0, 0, 0]) > 5  # skipped stale frames
    finally:
        src.close()


def test_drone_source_open_without_drone_raises_clean_error():
    from app.video.sources import DroneDirectSource, VideoSourceError

    src = DroneDirectSource("127.0.0.1")
    t0 = time.monotonic()
    with pytest.raises(VideoSourceError) as e:
        src.open()
    assert time.monotonic() - t0 < 8.0
    assert "Drone not reachable" in str(e.value)
    assert not src.link.running
