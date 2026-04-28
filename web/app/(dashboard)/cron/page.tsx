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

export const metadata = { title: 'Cron — CSI' };
export const dynamic = 'force-dynamic';

export default async function CronPage() {
  const sessions = await listSessions(15);
  const state = readRoutineState();
  const lastRun = sessions[0]?.started_at ?? null;
  const lastSucceeded = sessions.find((s) => s.status === 'succeeded' || s.status === 'finished');
  const failedRecently = sessions.slice(0, 5).filter((s) => s.status === 'failed').length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cron / Routine</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Last host"
          value={state?.host?.hostname ?? '—'}
          hint={state?.host?.last_run ? `last run ${fmtDateTime(state.host.last_run)}` : null}
        />
        <KpiCard
          label="Routine config"
          value={state?.config ? '✓ configured' : '— not yet'}
          hint={state?.config?.frequency ?? null}
        />
        <KpiCard
          label="Recent failures"
          value={failedRecently}
          tone={failedRecently > 0 ? 'bad' : 'good'}
          hint={`Among last 5 sessions${lastSucceeded ? ` · last success ${fmtDateTime(lastSucceeded.started_at)}` : ''}`}
        />
      </div>

      {state?.config ? (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Routine config
          </h2>
          <pre className="rounded-xl border border-zinc-200/80 bg-white p-4 text-xs font-mono text-zinc-700 overflow-x-auto">
            {JSON.stringify(state.config, null, 2)}
          </pre>
        </section>
      ) : null}

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
