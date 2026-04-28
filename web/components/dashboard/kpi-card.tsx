import type { ReactNode } from 'react';

export function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const valueTone =
    tone === 'good' ? 'text-emerald-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'bad' ? 'text-rose-700'
    : 'text-zinc-900';

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500">{hint}</div>
      ) : null}
    </div>
  );
}
