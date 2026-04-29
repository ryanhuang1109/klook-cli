import { buildCoverageReport } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { CoverageTable } from './coverage-table';

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

      <CoverageTable rows={rows} />
    </div>
  );
}
