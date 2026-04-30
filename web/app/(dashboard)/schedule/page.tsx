import { listSessions } from '@/lib/data';
import { readRoutineState } from '@/lib/routine-state';
import { KpiCard } from '@/components/dashboard/kpi-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime, durationBetween } from '@/lib/format';
import { getRoutineConfig, type RoutineConfig } from './actions';
import ConfigForm from './config-form';

export const metadata = { title: 'Schedule — CSI' };
export const dynamic = 'force-dynamic';

const DEFAULT_CONFIG: RoutineConfig = {
  pois: [],
  competitors: ['klook', 'trip', 'getyourguide', 'kkday'],
  limit_per_platform: 30,
  pin_top: 5,
  sort: 'reviews',
  screenshot: false,
};

export default async function SchedulePage() {
  const [sessions, configRow] = await Promise.all([
    listSessions(15),
    getRoutineConfig().catch((err) => {
      // Don't crash the page if Supabase is unreachable — just render the
      // form with defaults and surface the error inline below.
      return { __error: (err as Error).message } as unknown as Awaited<
        ReturnType<typeof getRoutineConfig>
      > & { __error?: string };
    }),
  ]);
  const state = readRoutineState();
  const lastRun = sessions[0]?.started_at ?? null;
  const lastSucceeded = sessions.find((s) => s.status === 'succeeded' || s.status === 'finished');
  const failedRecently = sessions.slice(0, 5).filter((s) => s.status === 'failed').length;

  const configErr = (configRow as unknown as { __error?: string })?.__error ?? null;
  const config = (configRow && !configErr ? (configRow as { config: RoutineConfig }).config : null)
    ?? DEFAULT_CONFIG;
  const updatedAt = (configRow as unknown as { updated_at?: string })?.updated_at ?? null;
  const updatedBy = (configRow as unknown as { updated_by?: string | null })?.updated_by ?? null;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Edit the daily-routine config below — saved values land in
          Supabase and the local cron picks them up on the next run via
          <code className="ml-1 px-1.5 py-0.5 bg-zinc-100 rounded font-mono text-xs">
            tours routine fetch-config
          </code>
          .
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Last host"
          value={state?.host?.hostname ?? '—'}
          hint={state?.host?.last_run ? `last run ${fmtDateTime(state.host.last_run)}` : null}
        />
        <KpiCard
          label="POIs configured"
          value={config.pois.length}
          hint={config.competitors.length + ' competitors'}
        />
        <KpiCard
          label="Recent failures"
          value={failedRecently}
          tone={failedRecently > 0 ? 'bad' : 'good'}
          hint={`Among last 5 sessions${lastSucceeded ? ` · last success ${fmtDateTime(lastSucceeded.started_at)}` : ''}`}
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Routine config
          {configErr ? (
            <span className="ml-2 text-rose-600 normal-case font-normal">
              · {configErr} (showing defaults)
            </span>
          ) : null}
        </h2>
        <ConfigForm
          initial={config}
          updatedAt={updatedAt}
          updatedBy={updatedBy}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
          Cron suggestions
        </h2>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 text-xs font-mono space-y-1 text-zinc-700">
          <div># daily price refresh of pinned activities (cheap)</div>
          <div>0 9 * * *  /path/to/klook-cli/scripts/daily-routine.sh pricing</div>
          <div className="pt-2"># weekly broad-coverage scan + re-pin (heavier)</div>
          <div>0 10 * * 0  /path/to/klook-cli/scripts/daily-routine.sh scan</div>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Add to your crontab via{' '}
          <code className="px-1 bg-zinc-100 rounded">crontab -e</code>. The
          script reads the config saved above on every run.
        </p>
      </section>

      {state?.host ? (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Host machine (last cron run)
          </h2>
          <div className="rounded-xl border border-zinc-200/80 bg-white p-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
              {Object.entries(state.host).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-zinc-500">{k}</dt>
                  <dd className="font-mono text-xs break-all mt-0.5">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Recent sessions
          {lastRun ? <span className="ml-2 text-zinc-400 normal-case font-normal">last {fmtDateTime(lastRun)}</span> : null}
        </h2>
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
            No sessions captured yet.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                  <TableHead className="w-[180px]">Started</TableHead>
                  <TableHead>POI</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs font-mono text-zinc-500">
                      {fmtDateTime(s.started_at)}
                    </TableCell>
                    <TableCell>{s.poi ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${
                          s.status === 'succeeded' || s.status === 'finished'
                            ? 'bg-emerald-100 text-emerald-800'
                            : s.status === 'failed'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-zinc-100 text-zinc-700'
                        } border-transparent`}
                      >
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-zinc-500">
                      {durationBetween(s.started_at, s.finished_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
