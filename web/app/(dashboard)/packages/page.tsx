import {
  listPackagesWithStats,
  type PackageWithStats,
  type Platform,
} from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { PackagesFilters } from './filters';
import { PackagesTable } from './packages-table';

export const metadata = { title: 'Packages — CSI' };
export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: Platform; poi?: string; activity?: string }>;
}) {
  const sp = await searchParams;
  const poiFilter = parseCsv(sp.poi);
  const activityFilter = parseCsv(sp.activity);
  const all = await listPackagesWithStats();
  const rows = all
    .filter((r) => {
      if (sp.platform && r.platform !== sp.platform) return false;
      if (poiFilter.length > 0 && (!r.poi || !poiFilter.includes(r.poi))) return false;
      if (activityFilter.length > 0 && !activityFilter.includes(activityKey(r))) return false;
      return true;
    })
    .sort((a, b) => {
      const ka = activityKey(a);
      const kb = activityKey(b);
      if (ka === kb) return (a.package_title ?? '').localeCompare(b.package_title ?? '');
      return ka.localeCompare(kb);
    });

  const allPois = uniq(all.map((r) => r.poi).filter(Boolean) as string[]).sort();
  const activityOptions = uniqActivities(all);
  const totalSkus = rows.reduce((a, r) => a + r.sku_count, 0);
  const withPrice = rows.filter((r) => r.min_price_usd != null);
  const avgMin =
    withPrice.length === 0
      ? null
      : withPrice.reduce((a, r) => a + (r.min_price_usd ?? 0), 0) / withPrice.length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
        <p className="text-sm text-zinc-500 mt-1">
          One row per package — the variant level under each activity. Click into{' '}
          <a className="text-blue-600 hover:underline" href="/activities">Activities</a>{' '}
          to see SKUs grouped by package, or{' '}
          <a className="text-blue-600 hover:underline" href="/skus">SKUs</a>{' '}
          for the per-date pricing grid.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Packages" value={rows.length} />
        <KpiCard label="SKUs" value={totalSkus} />
        <KpiCard label="POIs" value={uniq(rows.map((r) => r.poi).filter(Boolean) as string[]).length} />
        <KpiCard
          label="Avg min price"
          value={avgMin == null ? '—' : `$${Math.round(avgMin)}`}
        />
      </div>

      <PackagesFilters
        platforms={PLATFORMS}
        pois={allPois}
        activities={activityOptions}
        defaultPlatform={sp.platform}
        defaultPois={poiFilter}
        defaultActivities={activityFilter}
      />

      <PackagesTable
        rows={rows}
        sp={sp}
        emptyMessage={
          all.length === 0 ? 'No packages ingested yet.' : 'No packages match the filter.'
        }
      />
    </div>
  );
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function activityKey(r: PackageWithStats): string {
  return r.platform_product_id ?? `#${r.activity_id}`;
}

export type ActivityOption = {
  key: string;
  label: string;
  platform: Platform;
};

function uniqActivities(rows: PackageWithStats[]): ActivityOption[] {
  const map = new Map<string, ActivityOption>();
  for (const r of rows) {
    const key = activityKey(r);
    if (map.has(key)) continue;
    const id = r.platform_product_id ?? `#${r.activity_id}`;
    const title = r.activity_title ?? '(untitled)';
    map.set(key, { key, label: `${id} — ${title}`, platform: r.platform });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}
