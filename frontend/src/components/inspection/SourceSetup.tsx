import { useRef, useState } from 'react';
import { CheckCircle2, FileVideo, Loader2, PlugZap, Upload } from 'lucide-react';
import type { UploadInfo } from '@/types';
import { videoService } from '@/services/dataService';
import { fmtBytes, fmtDuration } from '@/utils/format';
import { cx } from '@/components/ui/primitives';

export const CAMERA_URI_KEY = 'aerospectra.cameraUri';

export function CameraSetup({ uri, onUri, disabled, backendOnline }: { uri: string; onUri: (v: string) => void; disabled?: boolean; backendOnline: boolean }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="space-y-2">
      <label className="label" htmlFor="cam-uri">Camera source (OpenCV)</label>
      <div className="flex gap-2">
        <input
          id="cam-uri"
          className="field num"
          value={uri}
          disabled={disabled}
          placeholder="0  ·  rtsp://…  ·  http://…"
          onChange={(e) => {
            onUri(e.target.value);
            localStorage.setItem(CAMERA_URI_KEY, e.target.value);
            setResult(null);
          }}
        />
        <button
          className="btn shrink-0"
          disabled={disabled || testing || !backendOnline || !uri.trim()}
          onClick={async () => {
            setTesting(true);
            try {
              setResult(await videoService.testCamera(uri.trim()));
            } catch (e) {
              setResult({ ok: false, message: (e as Error).message });
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Test
        </button>
      </div>
      {result && <div className={cx('text-xs', result.ok ? 'text-ok' : 'text-crit')}>{result.message}</div>}
      <p className="text-[11px] text-faint leading-snug">
        Device index (e.g. <span className="num">0</span>) or a stream URL that you have verified. The Elilvendan B2 / WiFi UFO stream protocol is not yet verified — a practical bridge is
        Android screen-mirroring (scrcpy) → OBS Virtual Camera → device index.
      </p>
    </div>
  );
}

export function UploadSetup({ info, onInfo, onLocalFile, disabled, backendOnline }: {
  info: UploadInfo | null; onInfo: (i: UploadInfo | null) => void; onLocalFile: (f: File | null) => void; disabled?: boolean; backendOnline: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    onLocalFile(f);
    onInfo(null);
    if (!backendOnline) {
      setError('Backend offline — the file will play locally but cannot be processed.');
      return;
    }
    setProgress(0);
    try {
      onInfo(await videoService.upload(f, setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="label">Inspection video file</div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files[0]);
        }}
        className={cx(
          'w-full rounded-lg border border-dashed px-4 py-4 text-left transition-colors flex items-center gap-3',
          drag ? 'border-steel bg-steel/10' : 'border-line-strong hover:border-steel bg-surface-2/40',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {progress != null ? <Loader2 className="size-5 animate-spin text-steel" /> : info ? <CheckCircle2 className="size-5 text-ok" /> : <Upload className="size-5 text-muted" />}
        <div className="min-w-0">
          <div className="text-sm text-ink font-medium truncate">
            {progress != null ? `Uploading… ${Math.round(progress * 100)}%` : info ? info.filename : 'Choose or drop a video (MP4, MOV, AVI, MKV, WEBM)'}
          </div>
          <div className="text-xs text-muted num">
            {info ? `${info.upload_id} · ${info.width}×${info.height} · ${info.fps.toFixed(0)} fps · ${fmtDuration(info.duration_s)} · ${fmtBytes(info.size_bytes)}` : 'Uploaded to the backend for OpenCV processing'}
          </div>
        </div>
        <FileVideo className="size-4 text-faint ml-auto shrink-0" />
      </button>
      <input ref={input} type="file" accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {progress != null && (
        <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
          <div className="h-full bg-steel" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {error && <div className="text-xs text-crit">{error}</div>}
    </div>
  );
}
