/** Backend sends naive UTC ISO strings; normalise so the browser parses them as UTC. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /([zZ]|[+-]\d\d:?\d\d)$/.test(s);
  const d = new Date(hasTz ? s : s + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(s: string | null | undefined): string {
  const d = parseDate(s);
  if (!d) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(s: string | null | undefined): string {
  const d = parseDate(s);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtRelative(s: string | null | undefined): string {
  const d = parseDate(s);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return fmtDate(s);
}

/** 00:02:14 */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

/** 14 min 05 s */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Money in the configured currency (INR default, Indian digit grouping). */
export function fmtMoney(v: number | null | undefined, currency = 'INR', compact = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '\u2014';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard',
    }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString()}`;
  }
}
export function fmtMoneyRange(lo?: number | null, hi?: number | null, currency = 'INR', compact = false): string {
  if (!lo && !hi) return '\u2014';
  return `${fmtMoney(lo ?? 0, currency, compact)} \u2013 ${fmtMoney(hi ?? 0, currency, compact)}`;
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
