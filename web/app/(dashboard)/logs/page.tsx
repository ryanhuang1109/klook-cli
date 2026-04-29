import { listExecutions, type Platform } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { ExecutionsFilters } from './filters';
import { LogsTable } from './logs-table';

export const metadata = { title: 'Logs — CSI' };
export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: Platform; hours?: string }>;
}) {
  const sp = await searchParams;
  const hours = sp.hours ?? '72';
  const sinceIso =
    hours && hours !== 'all'
      ? new Date(Date.now() - parseInt(hours, 10) * 3600 * 1000).toISOString()
      : undefined;
  const rows = await listExecutions({
    platform: sp.platform,
    sinceIso,
    limit: 200,
  });

  const totalCount = rows.length;
  const okCount = rows.filter((r) => r.succeeded === 1 || r.succeeded === true).length;
  const fallbackCount = rows.filter((r) => r.strategy === 'agent-browser-fallback').length;
  const totalPkg = rows.reduce((a, r) => a + (r.packages_written ?? 0), 0);
  const totalSku = rows.reduce((a, r) => a + (r.skus_written ?? 0), 0);
  const failRate = totalCount === 0 ? 0 : Math.round(((totalCount - okCount) / totalCount) * 100);

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <ExecutionsFilters
          platforms={PLATFORMS}
          defaultPlatform={sp.platform}
          defaultHours={hours}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total" value={totalCount} />
        <KpiCard
          label="Failed"
          value={`${totalCount - okCount}`}
          hint={`${failRate}%`}
          tone={failRate > 10 ? 'bad' : failRate > 0 ? 'warn' : 'good'}
        />
        <KpiCard
          label="Fallback used"
          value={fallbackCount}
          tone={fallbackCount > 0 ? 'warn' : 'default'}
        />
        <KpiCard label="Packages written" value={totalPkg} />
        <KpiCard label="SKUs written" value={totalSku} />
      </div>

      <LogsTable rows={rows} />
    </div>
  );
}
