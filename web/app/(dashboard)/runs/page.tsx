import { listSessions, listCoverageRuns, listSearchRuns } from '@/lib/data';
import { KpiCard } from '@/components/dashboard/kpi-card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { SessionDeepdive } from './session-deepdive';
import { CoverageRunsTable } from './coverage-runs-table';
import { SearchRunsTable } from './search-runs-table';

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
          <CoverageRunsTable rows={coverageRuns} />
        </TabsContent>

        <TabsContent value="search">
          <SearchRunsTable rows={searchRuns} />
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
