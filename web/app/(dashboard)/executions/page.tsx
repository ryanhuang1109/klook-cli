import { listExecutions, type Platform } from '@/lib/data';
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
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/format';
import { ExecutionsFilters } from './filters';

export const metadata = { title: 'Executions — CSI' };
export const dynamic = 'force-dynamic';

const PLATFORMS: Platform[] = ['klook', 'trip', 'getyourguide', 'kkday', 'airbnb'];

export default async function ExecutionsPage({
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
        <h1 className="text-2xl font-semibold tracking-tight">Executions</h1>
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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
          No executions match the filter.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                <TableHead className="w-[180px]">Started</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Pkg / SKU</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-mono text-zinc-500">
                    {fmtDateTime(r.started_at)}
                  </TableCell>
                  <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                  <TableCell className="font-mono text-xs text-zinc-700">{r.activity_id}</TableCell>
                  <TableCell><StrategyBadge strategy={r.strategy} /></TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-600">
                    {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </TableCell>
                  <TableCell><ResultBadge succeeded={r.succeeded} errorMessage={r.error_message} /></TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-zinc-600">
                    {r.packages_written ?? 0} / {r.skus_written ?? 0}
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

function StrategyBadge({ strategy }: { strategy: string }) {
  const tone =
    strategy === 'opencli-pricing' ? 'bg-blue-100 text-blue-800'
    : strategy === 'opencli-detail' ? 'bg-indigo-100 text-indigo-800'
    : strategy === 'opencli-search' ? 'bg-violet-100 text-violet-800'
    : strategy === 'agent-browser-fallback' ? 'bg-amber-100 text-amber-800'
    : strategy === 'snapshot' ? 'bg-zinc-200 text-zinc-700'
    : 'bg-zinc-100 text-zinc-600';
  return <Badge className={`${tone} hover:${tone} border-transparent`}>{strategy}</Badge>;
}

function ResultBadge({ succeeded, errorMessage }: { succeeded: number | boolean; errorMessage: string | null }) {
  const ok = succeeded === 1 || succeeded === true;
  return (
    <div className="inline-flex items-center gap-2">
      <Badge className={ok ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent' : 'bg-rose-100 text-rose-800 hover:bg-rose-100 border-transparent'}>
        {ok ? 'OK' : 'FAIL'}
      </Badge>
      {!ok && errorMessage ? (
        <span className="text-xs text-zinc-500 truncate max-w-md" title={errorMessage}>
          {errorMessage.slice(0, 60)}
        </span>
      ) : null}
    </div>
  );
}
