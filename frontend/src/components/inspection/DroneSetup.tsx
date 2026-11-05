import { useEffect, useState } from 'react';
import { Camera, HelpCircle, Loader2, PlugZap, RefreshCw, Wifi } from 'lucide-react';
import type { ActiveInspection } from '@/types';
import { droneService, type DroneProbe } from '@/services/dataService';
import { cx } from '@/components/ui/primitives';

export const DRONE_IP_KEY = 'aerospectra.droneIp';

type Chip = { label: string; tone: 'ok' | 'warn' | 'crit' | 'idle' };

/** Direct Wi-Fi drone source (Elilvendan B2 / E88 Pro, RC UFO "cooingdv" protocol). */
export function DroneSetup({ ip, onIp, disabled, backendOnline, active }: {
  ip: string; onIp: (v: string) => void; disabled?: boolean; backendOnline: boolean; active: ActiveInspection | null;
}) {
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<DroneProbe | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lens, setLens] = useState<'front' | 'bottom'>('front');
  const [lensBusy, setLensBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [live, setLive] = useState<{ alive?: boolean; state?: string; replies?: number } | null>(null);
  const droneActive = active?.source === 'drone_direct';

  // auto-fill the drone IP from the backend (192.168.1.1 or the Wi-Fi default gateway)
  const detect = (force = false) =>
    droneService.status(!force && ip && ip !== 'auto' ? ip : undefined).then((s) => {
      if (force || !ip || ip === 'auto') {
        onIp(s.detected_ip ?? s.ip ?? '192.168.1.1');
        localStorage.removeItem(DRONE_IP_KEY); // auto-detected values are not pinned
      }
      setWarnings(s.warnings ?? []);
      setProbe(null);
    }).catch(() => undefined);
  useEffect(() => {
    if (backendOnline) detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);

  // live link status while a drone inspection runs
  useEffect(() => {
    if (!backendOnline || !droneActive) return setLive(null);
    const tick = () => droneService.status().then((s) => setLive({ alive: s.alive, state: s.state, replies: s.heartbeat_replies })).catch(() => undefined);
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [backendOnline, droneActive]);

  const chip: Chip = !backendOnline
    ? { label: 'Backend offline', tone: 'idle' }
    : droneActive
      ? active?.connected === false || live?.state === 'reconnecting'
        ? { label: 'Reconnecting…', tone: 'warn' }
        : { label: live?.alive ? 'Heartbeat OK · streaming' : 'Streaming', tone: 'ok' }
      : probe
        ? probe.ok
          ? { label: probe.alive || probe.heartbeat_replies ? 'Heartbeat OK' : 'Video OK', tone: 'ok' }
          : { label: 'No drone', tone: 'crit' }
        : { label: 'Not tested', tone: 'idle' };

  const test = async () => {
    setTesting(true);
    setProbe(null);
    try {
      setProbe(await droneService.test(ip.trim() || undefined));
    } catch (e) {
      setProbe({ ok: false, message: (e as Error).message } as DroneProbe);
    } finally {
      setTesting(false);
    }
  };

  const switchLens = async (l: 'front' | 'bottom') => {
    setLensBusy(true);
    try {
      await droneService.camera(l, ip.trim() || undefined);
      setLens(l);
    } catch {
      /* surfaced by status */
    } finally {
      setLensBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="label !mb-0" htmlFor="drone-ip">Drone IP (direct Wi-Fi)</label>
        <span
          className={cx(
            'chip font-semibold',
            chip.tone === 'ok' && 'border-ok/40 bg-ok/10 text-ok-ink',
            chip.tone === 'warn' && 'border-warn/50 bg-warn/15 text-warn-ink',
            chip.tone === 'crit' && 'border-crimson/40 bg-crimson/10 text-crit-ink',
            chip.tone === 'idle' && 'border-line text-muted',
          )}
          aria-live="polite"
        >
          <span className={cx('size-2 rounded-full', chip.tone === 'ok' ? 'bg-ok pulse-dot' : chip.tone === 'warn' ? 'bg-warn animate-pulse' : chip.tone === 'crit' ? 'bg-crit' : 'bg-ink/30')} />
          {chip.label}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id="drone-ip"
          className="field num"
          value={ip}
          disabled={disabled}
          placeholder="192.168.1.1"
          onChange={(e) => {
            onIp(e.target.value);
            localStorage.setItem(DRONE_IP_KEY, e.target.value);
            setProbe(null);
          }}
        />
        <button className="btn shrink-0" disabled={disabled || !backendOnline} onClick={() => detect(true)} title="Re-detect the drone IP (after switching Wi-Fi)" aria-label="Re-detect drone IP">
          <RefreshCw className="size-4" />
        </button>
        <button className="btn shrink-0" disabled={disabled || testing || !backendOnline} onClick={test} title="Heartbeat + grab one frame (max 8 s)">
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Test drone
        </button>
      </div>
      {warnings.map((w) => <div key={w} className="text-[11px] text-warn-ink">{w}</div>)}

      {probe && (
        <div className={cx('rounded-lg border p-2.5 text-xs space-y-2', probe.ok ? 'border-ok/40 bg-ok/5' : 'border-crimson/40 bg-crimson/5')}>
          <div className={probe.ok ? 'text-ok-ink font-semibold' : 'text-crit-ink'}>{probe.message}</div>
          {probe.preview_jpeg && <img src={probe.preview_jpeg} alt="Drone camera preview" className="w-full rounded-md border border-line bg-black" />}
          {probe.ip && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] num">
              <span className="text-muted">IP</span><span>{probe.ip}</span>
              <span className="text-muted">Resolution</span><span>{probe.width ? `${probe.width}×${probe.height}` : '—'}</span>
              <span className="text-muted">FPS</span><span>{probe.fps || '—'}</span>
              <span className="text-muted">Transport</span><span>{probe.transport ? `RTSP/${probe.transport.toUpperCase()}` : '—'}</span>
              <span className="text-muted">Heartbeat replies</span><span>{probe.heartbeat_replies ?? 0}{probe.module_id != null ? ` (module ${probe.module_id})` : ''}</span>
              <span className="text-muted">RTSP :7070</span><span>{probe.rtsp_reachable == null ? '—' : probe.rtsp_reachable ? 'reachable' : 'not reachable'}</span>
              <span className="text-muted">Took</span><span>{probe.elapsed_s ?? '—'} s</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <Camera className="size-3.5 text-muted" />
        <span className="text-muted">Lens</span>
        {(['front', 'bottom'] as const).map((l) => (
          <button key={l} type="button" disabled={lensBusy || !backendOnline} onClick={() => switchLens(l)}
            className={cx('btn btn-sm capitalize', lens === l && 'border-steel bg-steel/15 text-ink')}>
            {l}
          </button>
        ))}
        {lensBusy && <Loader2 className="size-3.5 animate-spin text-muted" />}
      </div>

      <button type="button" className="text-[11px] text-steel-bright inline-flex items-center gap-1 hover:underline" onClick={() => setHelp((h) => !h)}>
        <HelpCircle className="size-3.5" /> {help ? 'Hide' : 'Show'} drone connection help
      </button>
      {help && (
        <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-[11px] text-ink-2 space-y-1.5">
          <div className="font-semibold flex items-center gap-1.5"><Wifi className="size-3.5" /> Direct Wi-Fi to the drone (no phone needed)</div>
          <ol className="list-decimal ml-4 space-y-1">
            <li><b>Close RC UFO</b> on the phone — the drone accepts one video client at a time.</li>
            <li>Connect <b>this laptop's Wi-Fi</b> to the drone (<span className="num">WIFI-UFO-…</span> / <span className="num">FLY-UFO-…</span>).</li>
            <li>Allow Python through <b>Windows Firewall on PUBLIC networks</b>: in an Administrator PowerShell run
              <code className="block num mt-1 p-1.5 rounded bg-ink/5 select-all">powershell -ExecutionPolicy Bypass -File tools\allow_firewall.ps1</code>
            </li>
            <li><b>Fly with the physical remote.</b> AeroSpectra only sends the video heartbeat (01 01 → UDP 7099) and lens-select commands — never flight commands.</li>
          </ol>
          <div className="text-faint">Field check without the app: <code className="num">venv\Scripts\python tools\drone_check.py</code>. If the link fails during judging, switch to <b>Uploaded Video</b>.</div>
        </div>
      )}
    </div>
  );
}
