export function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '—';
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString().slice(0, 19).replace('T', ' ') : '—';
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  return `${(min / 60).toFixed(1)}h`;
}

export function priceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return '—';
  if (min === max || max == null) return fmtUsd(min);
  if (min == null) return `≤ ${fmtUsd(max)}`;
  return `${fmtUsd(min)} – ${fmtUsd(max)}`;
}

export function durationBetween(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0 || isNaN(ms)) return '—';
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min}m` : `${(min / 60).toFixed(1)}h`;
}
