import {
  listPackagesWithStats,
  type PackageWithStats,
  type Platform,
} from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtDate, fmtDuration, fmtNum, priceRange } from '@/lib/format';
import { PackagesFilters } from './filters';

export const metadata = { title: 'Packages — CSI' };
export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: Platform; poi?: string }>;
}) {
  const sp = await searchParams;
  const all = await listPackagesWithStats();
  const rows = all.filter((r) => {
    if (sp.platform && r.platform !== sp.platform) return false;
    if (sp.poi && r.poi !== sp.poi) return false;
    return true;
  });

  const allPois = uniq(all.map((r) => r.poi).filter(Boolean) as string[]).sort();
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
        defaultPlatform={sp.platform}
        defaultPoi={sp.poi}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
          {all.length === 0 ? 'No packages ingested yet.' : 'No packages match the filter.'}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                <TableHead className="w-[88px]">Platform</TableHead>
                <TableHead className="w-[110px]">POI</TableHead>
                <TableHead>Activity / Package</TableHead>
                <TableHead className="w-[80px]">Tour</TableHead>
                <TableHead className="w-[80px]">Group</TableHead>
                <TableHead className="w-[64px]">Meals</TableHead>
                <TableHead className="w-[120px]">Languages</TableHead>
                <TableHead className="w-[100px]">Departure</TableHead>
                <TableHead className="w-[80px] text-right">Duration</TableHead>
                <TableHead className="w-[64px] text-right">SKUs</TableHead>
                <TableHead className="w-[140px] text-right">USD range</TableHead>
                <TableHead className="w-[100px] text-right">Last</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                  <TableCell className="text-zinc-700 truncate" title={r.poi ?? ''}>
                    {r.poi ?? '—'}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <div className="truncate font-medium" title={r.package_title ?? ''}>
                      {r.package_title ?? '(untitled package)'}
                    </div>
                    <div className="truncate text-xs text-zinc-400" title={r.activity_title ?? ''}>
                      {r.activity_title ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-700">{r.tour_type || '—'}</TableCell>
                  <TableCell className="text-xs text-zinc-700">{r.group_size || '—'}</TableCell>
                  <TableCell className="text-xs text-zinc-700">{mealsLabel(r.meals)}</TableCell>
                  <TableCell className="text-xs text-zinc-700 truncate" title={langSummary(r.available_languages)}>
                    {langSummary(r.available_languages)}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-700 truncate">
                    {r.departure_city || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-zinc-600">
                    {fmtDuration(r.duration_minutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.sku_count)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {priceRange(r.min_price_usd, r.max_price_usd)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-zinc-500">
                    {fmtDate(r.last_checked_at)}
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

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function mealsLabel(m: PackageWithStats['meals']): string {
  if (m === true) return 'yes';
  if (m === false) return 'no';
  return '—';
}

function langSummary(v: PackageWithStats['available_languages']): string {
  if (!v) return '—';
  let arr: unknown = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return v; }
  }
  if (!Array.isArray(arr)) return '—';
  if (arr.length === 0) return '—';
  if (arr.length <= 2) return arr.join(', ');
  return `${arr.slice(0, 2).join(', ')} +${arr.length - 2}`;
}
