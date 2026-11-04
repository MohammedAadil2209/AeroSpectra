import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { BBox, Category } from '@/types';
import { mediaUrl } from '@/services/api';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@/utils/labels';
import { cx } from './primitives';

/** Evidence frame with the detection bounding box overlaid from normalised coordinates. */
export function EvidenceImage({ url, bbox, category, confidence, className, showLabel = true, thumb }: {
  url: string | null; bbox?: BBox; category?: Category; confidence?: number; className?: string; showLabel?: boolean; thumb?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(url);
  const color = category ? CATEGORY_COLOR[category] : '#669bbc';
  if (!src || failed) {
    return (
      <div className={cx('grid place-items-center bg-surface-2 text-faint aspect-video rounded-md', className)}>
        <div className="flex flex-col items-center gap-1 text-xs">
          <ImageOff className={thumb ? 'size-4' : 'size-6'} />
          {!thumb && 'Evidence image unavailable'}
        </div>
      </div>
    );
  }
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-black aspect-video', className)}>
      <img src={src} alt={category ? `${CATEGORY_LABEL[category]} evidence` : 'Evidence'} className="absolute inset-0 size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      {bbox && (
        <div
          className="absolute"
          style={{
            left: `${bbox.x * 100}%`, top: `${bbox.y * 100}%`, width: `${bbox.w * 100}%`, height: `${bbox.h * 100}%`,
            border: `${thumb ? 1.5 : 2}px solid ${color}`, boxShadow: '0 0 0 1px rgba(0,0,0,.45)',
          }}
        >
          {showLabel && !thumb && category && (
            <span className="absolute -top-5 left-[-2px] px-1.5 h-[18px] text-[10px] font-semibold text-white whitespace-nowrap rounded-t-sm flex items-center" style={{ background: color }}>
              {CATEGORY_LABEL[category].toUpperCase()} {confidence != null && `${Math.round(confidence * 100)}%`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
