import { listSessions, listCoverageRuns, listSearchRuns } from '@/lib/data';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { SessionDeepdive } from './session-deepdive';

export const metadata = { title: 'Runs — CSI' };
export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const [sessions, coverageRuns, searchRuns] = await Promise.all([
    listSessions(50),
    listCoverageRuns(100),
    listSearchRuns(100),
  ]);

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Click a session row to deep-dive into its executions.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="Sessions" value={sessions.length} />
        <KpiCard label="Coverage runs" value={coverageRuns.length} />
        <KpiCard label="Search runs" value={searchRuns.length} />
      </div>

      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          {sessions.length === 0 ? <Empty /> : <SessionDeepdive sessions={sessions} />}
        </TabsContent>

        <TabsContent value="coverage">
          {coverageRuns.length === 0 ? (
            <Empty />
          ) : (
            <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                    <TableHead className="w-[180px]">Run at</TableHead>
                    <TableHead>POI</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Filter</TableHead>
                    <TableHead className="text-right">Fetched</TableHead>
                    <TableHead className="text-right">New unique</TableHead>
                    <TableHead className="text-right">Total reported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coverageRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono text-zinc-500">
                        {fmtDateTime(r.run_at)}
                      </TableCell>
                      <TableCell>{r.poi}</TableCell>
                      <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                      <TableCell className="text-xs font-mono text-zinc-500 truncate max-w-[16rem]" title={r.filter_signature}>
                        {r.filter_signature}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.fetched)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmtNum(r.new_unique)}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-600">{fmtNum(r.total_reported)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="search">
          {searchRuns.length === 0 ? (
            <Empty />
          ) : (
            <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
                    <TableHead className="w-[180px]">Run at</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Keyword</TableHead>
                    <TableHead>POI</TableHead>
                    <TableHead className="text-right">Found</TableHead>
                    <TableHead className="text-right">Ingested</TableHead>
                    <TableHead className="text-right">OK / Fail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono text-zinc-500">
                        {fmtDateTime(r.run_at)}
                      </TableCell>
                      <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                      <TableCell>{r.keyword}</TableCell>
                      <TableCell className="text-zinc-700">{r.poi ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.found)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmtNum(r.ingested)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        <span className="text-emerald-700">{r.succeeded ?? 0}</span>
                        {' / '}
                        <span className="text-rose-700">{r.failed ?? 0}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
      No data yet.
    </div>
  );
}
