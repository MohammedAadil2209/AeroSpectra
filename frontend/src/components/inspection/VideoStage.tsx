import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, RefreshCw, VideoOff } from 'lucide-react';
import type { SourceType } from '@/types';
import { SourceChip, cx } from '@/components/ui/primitives';
import { fmtClock } from '@/utils/format';

/** Large video monitor: MJPEG stream from backend, local file preview, or idle placeholder. */
export function VideoStage({
  streamUrl,
  localVideoUrl,
  source,
  recording,
  paused,
  elapsed,
  inspectionId,
  aircraftId,
  connection,
  children,
  idle,
}: {
  streamUrl: string | null;
  localVideoUrl: string | null;
  source: SourceType;
  recording: boolean;
  paused: boolean;
  elapsed: number;
  inspectionId: string | null;
  aircraftId: string | null;
  connection: 'connected' | 'offline' | 'idle';
  children?: ReactNode;
  idle?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [streamErr, setStreamErr] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => setStreamErr(false), [streamUrl]);

  const content = streamUrl ? (
    streamErr ? (
      <div className="absolute inset-0 grid place-items-center text-center p-6">
        <div>
          <VideoOff className="size-8 text-muted mx-auto mb-2" />
          <div className="font-semibold">Video stream interrupted</div>
          <button className="btn btn-sm mt-3" onClick={() => (setStreamErr(false), setNonce((n) => n + 1))}>
            <RefreshCw className="size-3.5" /> Reconnect stream
          </button>
        </div>
      </div>
    ) : (
      <img key={nonce} src={`${streamUrl}&r=${nonce}`} alt="Annotated inspection video stream" className="absolute inset-0 size-full object-contain" onError={() => setStreamErr(true)} />
    )
  ) : localVideoUrl ? (
    <video src={localVideoUrl} className="absolute inset-0 size-full object-contain" controls muted playsInline />
  ) : (
    <div className="absolute inset-0 grid place-items-center p-6">{idle}</div>
  );

  return (
    <div ref={box} className={cx('theme-dark relative bg-black overflow-hidden', fs ? '' : 'aspect-video rounded-lg border border-line')}>
      {content}
      {children}
      {/* overlay HUD */}
      <div className="absolute inset-x-0 top-0 p-3 flex flex-wrap items-start gap-2 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
        <SourceChip source={source} />
        {source === 'simulation' && <span className="chip bg-crimson text-white border-crimson">SIMULATED FOOTAGE</span>}
        {localVideoUrl && !streamUrl && <span className="chip bg-black/50 text-cream border-cream/30">LOCAL PREVIEW · NOT PROCESSED</span>}
        <span
          className={cx(
            'chip bg-black/50',
            connection === 'connected' ? 'text-ok-ink border-ok/40' : connection === 'offline' ? 'text-crit-ink border-crimson/50' : 'text-muted border-white/15',
          )}
        >
          <span className={cx('size-1.5 rounded-full', connection === 'connected' ? 'bg-ok pulse-dot' : connection === 'offline' ? 'bg-crit' : 'bg-faint')} />
          {connection === 'connected' ? 'STREAMING' : connection === 'offline' ? 'BACKEND OFFLINE' : 'STANDBY'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {recording && (
            <span className="chip bg-crimson/90 text-white border-crimson">
              <span className="size-1.5 rounded-full bg-white pulse-dot" /> REC
            </span>
          )}
          {paused && <span className="chip bg-warn/90 text-abyss border-warn">PAUSED</span>}
          <span className="chip bg-black/50 text-cream border-white/15 num text-xs">{fmtClock(elapsed)}</span>
        </div>
      </div>
      {!streamUrl && <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
        <div className="text-[11px] text-ink-2 num">
          {inspectionId ? `SESSION ${inspectionId}` : 'NO ACTIVE SESSION'}
          {aircraftId && ` · AIRCRAFT ${aircraftId}`}
        </div>
      </div>}
      <button
        className={cx("absolute right-2.5 btn btn-sm bg-black/50", streamUrl ? "top-12" : "bottom-2.5")}
        onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen())}
        aria-label={fs ? 'Exit full screen' : 'Full screen'}
      >
        {fs ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    </div>
  );
}
