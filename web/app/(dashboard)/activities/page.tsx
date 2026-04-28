import { listActivitiesWithStats, type ActivityRow, type Platform } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { ActivitiesFilters } from './filters';
import { ActivitiesTable } from './table';

export const metadata = { title: 'Activities — CSI' };
export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ poi?: string; platform?: Platform; q?: string }>;
}) {
  const sp = await searchParams;
  const rows = await listActivitiesWithStats({
    poi: sp.poi,
    platform: sp.platform,
    search: sp.q,
    limit: 500,
  });

  const totals = summarize(rows);
  const allPois = await collectPois();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Activities" value={totals.activities} />
        <KpiCard label="Packages" value={totals.packages} />
        <KpiCard label="SKUs" value={totals.skus} />
        <KpiCard label="Platforms" value={totals.platforms} />
        <KpiCard label="POIs" value={totals.pois} />
      </div>

      <ActivitiesFilters
        platforms={PLATFORMS}
        pois={allPois}
        defaultPlatform={sp.platform}
        defaultPoi={sp.poi}
        defaultQ={sp.q}
      />

      <ActivitiesTable rows={rows} />
    </div>
  );
}

function summarize(rows: ActivityRow[]) {
  return {
    activities: rows.length,
    packages: rows.reduce((a, r) => a + (r.package_count ?? 0), 0),
    skus: rows.reduce((a, r) => a + (r.sku_count ?? 0), 0),
    platforms: new Set(rows.map((r) => r.platform)).size,
    pois: new Set(rows.filter((r) => r.poi).map((r) => r.poi!.toLowerCase())).size,
  };
}

async function collectPois(): Promise<string[]> {
  const sample = await listActivitiesWithStats({ limit: 1000 });
  const set = new Set<string>();
  for (const r of sample) if (r.poi) set.add(r.poi);
  return [...set].sort((a, b) => a.localeCompare(b));
}
