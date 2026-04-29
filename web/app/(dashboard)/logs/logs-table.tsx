'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/format';
import type { ExecutionRow } from '@/lib/data';

export function LogsTable({ rows }: { rows: ExecutionRow[] }) {
  const columns = useMemo<ColumnDef<ExecutionRow>[]>(
    () => [
      {
        id: 'started',
        header: 'Started',
        accessorFn: (r) => r.started_at ?? '',
        size: 180,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-zinc-500">{fmtDateTime(row.original.started_at)}</span>
        ),
      },
      {
        id: 'platform',
        header: 'Platform',
        accessorFn: (r) => r.platform,
        size: 110,
        cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
      },
      {
        id: 'activity',
        header: 'Activity',
        accessorFn: (r) => r.activity_id ?? '',
        size: 140,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-zinc-700">{row.original.activity_id}</span>
        ),
      },
      {
        id: 'strategy',
        header: 'Strategy',
        accessorFn: (r) => r.strategy ?? '',
        size: 200,
        cell: ({ row }) => <StrategyBadge strategy={row.original.strategy} />,
      },
      {
        id: 'duration',
        header: () => <span className="block text-right">Duration</span>,
        accessorFn: (r) => r.duration_ms ?? 0,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">
            {row.original.duration_ms ? `${(row.original.duration_ms / 1000).toFixed(1)}s` : '—'}
          </div>
        ),
      },
      {
        id: 'result',
        header: 'Result',
        accessorFn: (r) => (r.succeeded === 1 || r.succeeded === true ? 1 : 0),
        size: 280,
        cell: ({ row }) => (
          <ResultBadge
            succeeded={row.original.succeeded}
            errorMessage={row.original.error_message}
          />
        ),
      },
      {
        id: 'pkgsku',
        header: () => <span className="block text-right">Pkg / SKU</span>,
        accessorFn: (r) => (r.packages_written ?? 0) + (r.skus_written ?? 0),
        size: 110,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-xs text-zinc-600">
            {row.original.packages_written ?? 0} / {row.original.skus_written ?? 0}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      storageKey="logs"
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      emptyMessage="No logs match the filter."
    />
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

function ResultBadge({
  succeeded,
  errorMessage,
}: {
  succeeded: number | boolean;
  errorMessage: string | null;
}) {
  const ok = succeeded === 1 || succeeded === true;
  return (
    <div className="inline-flex items-center gap-2">
      <Badge
        className={
          ok
            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent'
            : 'bg-rose-100 text-rose-800 hover:bg-rose-100 border-transparent'
        }
      >
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
