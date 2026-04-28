import { buildCoverageReport } from '@/lib/data';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Coverage — CSI' };
export const dynamic = 'force-dynamic';

export default async function CoveragePage() {
  const rows = await buildCoverageReport();

  const totals = {
    pairs: rows.length,
    averaged: rows.filter((r) => r.coverage_pct != null),
  };
  const avgPct =
    totals.averaged.length === 0
      ? null
      : totals.averaged.reduce((a, r) => a + (r.coverage_pct ?? 0), 0) / totals.averaged.length;
  const lowCoverage = rows.filter((r) => r.coverage_pct != null && r.coverage_pct < 0.5).length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coverage</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="POI × Platform pairs" value={totals.pairs} />
        <KpiCard
          label="Avg coverage"
          value={avgPct == null ? '—' : `${Math.round(avgPct * 100)}%`}
        />
        <KpiCard
          label="Below 50%"
          value={lowCoverage}
          tone={lowCoverage > 0 ? 'warn' : 'good'}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
          No coverage runs yet — run <code className="text-xs bg-zinc-100 px-1 rounded">tours ingest-listing</code> first.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                <TableHead>POI</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Filters</TableHead>
                <TableHead className="text-right">Unique</TableHead>
                <TableHead className="text-right">Reported</TableHead>
                <TableHead className="text-right w-[120px]">Coverage</TableHead>
                <TableHead className="text-right">Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.poi}-${r.platform}`}>
                  <TableCell className="font-medium">{r.poi}</TableCell>
                  <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-600">{r.filter_count}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.cumulative_unique}</TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-600">
                    {r.max_total_reported ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <CoverageBar pct={r.coverage_pct} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-zinc-500 font-mono">
                    {fmtDateTime(r.last_run_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-400">—</span>;
  const v = Math.round(pct * 100);
  const tone =
    v >= 90 ? 'bg-emerald-500'
    : v >= 50 ? 'bg-amber-500'
    : 'bg-rose-500';
  return (
    <div className="inline-flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${tone} transition-all`}
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium text-zinc-700 w-9 text-right">
        {v}%
      </span>
    </div>
  );
}
