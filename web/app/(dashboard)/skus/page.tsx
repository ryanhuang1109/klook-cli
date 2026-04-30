import { readPlanningRows, otaToPlatform, type PlanningRow } from '@/lib/planning';
import type { Platform } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SkusFilters } from './filters';
import { SkusPagination } from './pagination';
import { SkusTable } from './skus-table';

export const metadata = { title: 'SKUs — CSI' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function SkusPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: Platform; poi?: string; activity?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const poiFilter = parseCsv(sp.poi);
  const activityFilter = parseCsv(sp.activity);

  const all = readPlanningRows();
  const filtered = sortByActivity(filter(all, sp.platform, poiFilter, activityFilter));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const allPois = uniqSorted(all.map((r) => r.main_poi).filter(Boolean));
  const platformScoped = sp.platform
    ? all.filter((r) => otaToPlatform(r.ota) === sp.platform)
    : all;
  const activityOptions = uniqActivities(platformScoped);
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
        activities={activityOptions}
        defaultPlatform={sp.platform}
        defaultPois={poiFilter}
        defaultActivities={activityFilter}
      />

      <SkusTable
        rows={rows}
        sp={sp}
        emptyMessage={
          all.length === 0
            ? 'No CSV ingested yet — run the daily routine and `tours export-csv`.'
            : 'No rows match the filter.'
        }
      />
      {filtered.length > 0 ? <SkusPagination page={safePage} totalPages={totalPages} /> : null}
    </div>
  );
}

function filter(
  rows: PlanningRow[],
  platform: Platform | undefined,
  pois: string[],
  activities: string[],
): PlanningRow[] {
  return rows.filter((r) => {
    if (platform) {
      const p = otaToPlatform(r.ota);
      if (p !== platform) return false;
    }
    if (pois.length > 0 && (!r.main_poi || !pois.includes(r.main_poi))) return false;
    if (activities.length > 0 && (!r.product_id || !activities.includes(r.product_id))) return false;
    return true;
  });
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function sortByActivity(rows: PlanningRow[]): PlanningRow[] {
  return [...rows].sort((a, b) => {
    if (a.product_id !== b.product_id) {
      return (a.product_id ?? '').localeCompare(b.product_id ?? '');
    }
    if (a.travel_date !== b.travel_date) {
      return (a.travel_date ?? '').localeCompare(b.travel_date ?? '');
    }
    return (a.language ?? '').localeCompare(b.language ?? '');
  });
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export type SkuActivityOption = { id: string; label: string };

function uniqActivities(rows: PlanningRow[]): SkuActivityOption[] {
  const map = new Map<string, SkuActivityOption>();
  for (const r of rows) {
    if (!r.product_id) continue;
    if (map.has(r.product_id)) continue;
    map.set(r.product_id, {
      id: r.product_id,
      label: `${r.product_id} — ${r.activity_title || '(untitled)'}`,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
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
  return iso.replace('T', ' ').replace(/\..*Z?$/, '').replace('Z', '');
}
