import { readPlanningRows, otaToPlatform, type PlanningRow } from '@/lib/planning';
import type { Platform } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SkusFilters } from './filters';
import { SkusPagination } from './pagination';

export const metadata = { title: 'SKUs — CSI' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function SkusPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: Platform; poi?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const all = readPlanningRows();
  const filtered = filter(all, sp.platform, sp.poi);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const allPois = uniqSorted(all.map((r) => r.main_poi).filter(Boolean));
  const lastChecked = pickLatest(all);

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SKUs</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Planning sheet format — one row per (package × language × travel date).
          </p>
        </div>
        <a
          href="/exports/latest.csv"
          download
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          Download CSV
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total rows" value={all.length} />
        <KpiCard label="Filtered" value={filtered.length} />
        <KpiCard label="POIs" value={uniqSorted(all.map((r) => r.main_poi)).length} />
        <KpiCard label="Last check" value={lastChecked ?? '—'} />
      </div>

      <SkusFilters
        platforms={PLATFORMS}
        pois={allPois}
        defaultPlatform={sp.platform}
        defaultPoi={sp.poi}
      />

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
          {all.length === 0
            ? 'No CSV ingested yet — run the daily routine and `tours export-csv`.'
            : 'No rows match the filter.'}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-200/80 bg-white overflow-x-auto">
            <Table className="min-w-[2400px]">
              <TableHeader>
                <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                  <TableHead className="w-[110px] sticky left-0 bg-zinc-50/50">OTA</TableHead>
                  <TableHead className="w-[120px]">Main POI</TableHead>
                  <TableHead className="w-[280px]">Activity</TableHead>
                  <TableHead className="w-[100px]">Language</TableHead>
                  <TableHead className="w-[90px]">Tour</TableHead>
                  <TableHead className="w-[90px]">Group</TableHead>
                  <TableHead className="w-[80px]">Meals</TableHead>
                  <TableHead className="w-[120px]">Departure</TableHead>
                  <TableHead className="w-[110px]">Travel date</TableHead>
                  <TableHead className="w-[160px]">Last checked</TableHead>
                  <TableHead className="w-[100px] text-right">USD</TableHead>
                  <TableHead className="w-[120px] text-right">Local</TableHead>
                  <TableHead className="w-[180px]">Supplier</TableHead>
                  <TableHead className="w-[80px] text-right">Rating</TableHead>
                  <TableHead className="w-[90px] text-right">Reviews</TableHead>
                  <TableHead className="w-[90px] text-right">Orders</TableHead>
                  <TableHead className="w-[120px]">Lowest price URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.product_id}-${r.language}-${r.travel_date}-${i}`}>
                    <TableCell className="sticky left-0 bg-white text-xs font-medium">
                      {r.ota}
                    </TableCell>
                    <TableCell className="text-zinc-700">{r.main_poi || '—'}</TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="truncate" title={r.activity_title}>
                        {r.activity_title || '—'}
                      </div>
                      <div className="truncate text-xs text-zinc-400 font-mono">
                        {r.product_id}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{r.language || '—'}</TableCell>
                    <TableCell className="text-xs">{r.tour_type || '—'}</TableCell>
                    <TableCell className="text-xs">{r.group_size || '—'}</TableCell>
                    <TableCell className="text-xs">{r.meals || '—'}</TableCell>
                    <TableCell className="text-xs">{r.departure_city || '—'}</TableCell>
                    <TableCell className="text-xs font-mono text-zinc-700">
                      {r.travel_date || '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-zinc-500">
                      {fmtCheckDate(r.check_date_time)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {r.price_usd ? `$${r.price_usd}` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-600">
                      {r.price_destination_local || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600 overflow-hidden">
                      <div className="truncate" title={r.supplier}>
                        {r.supplier || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.rating || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-600">
                      {r.review_count || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-zinc-600">
                      {r.order_count || '—'}
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      {r.lowest_price_aid ? (
                        <a
                          href={r.lowest_price_aid}
                          target="_blank"
                          rel="noopener"
                          className="text-xs text-blue-600 hover:underline truncate block"
                          title={r.lowest_price_aid}
                        >
                          open ↗
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <SkusPagination page={safePage} totalPages={totalPages} />
        </>
      )}
    </div>
  );
}

function filter(
  rows: PlanningRow[],
  platform?: Platform,
  poi?: string,
): PlanningRow[] {
  return rows.filter((r) => {
    if (platform) {
      const p = otaToPlatform(r.ota);
      if (p !== platform) return false;
    }
    if (poi && r.main_poi !== poi) return false;
    return true;
  });
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function pickLatest(rows: PlanningRow[]): string | null {
  let max: string | null = null;
  for (const r of rows) {
    if (!r.check_date_time) continue;
    if (!max || r.check_date_time > max) max = r.check_date_time;
  }
  return max ? fmtCheckDate(max) : null;
}

function fmtCheckDate(iso: string): string {
  if (!iso) return '—';
  // Strip the trailing Z and milliseconds for compactness.
  return iso.replace('T', ' ').replace(/\..*Z?$/, '').replace('Z', '');
}
