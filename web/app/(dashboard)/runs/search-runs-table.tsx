'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDateTime, fmtNum } from '@/lib/format';
import type { SearchRunRow } from '@/lib/data';

export function SearchRunsTable({ rows }: { rows: SearchRunRow[] }) {
  const columns = useMemo<ColumnDef<SearchRunRow>[]>(
    () => [
      {
        id: 'run_at',
        header: 'Run at',
        accessorFn: (r) => r.run_at ?? '',
        size: 180,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-zinc-500">{fmtDateTime(row.original.run_at)}</span>
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
        id: 'keyword',
        header: 'Keyword',
        accessorFn: (r) => r.keyword ?? '',
        size: 220,
        cell: ({ row }) => row.original.keyword,
      },
      {
        id: 'poi',
        header: 'POI',
        accessorFn: (r) => r.poi ?? '',
        size: 140,
        cell: ({ row }) => <span className="text-zinc-700">{row.original.poi ?? '—'}</span>,
      },
      {
        id: 'found',
        header: () => <span className="block text-right">Found</span>,
        accessorFn: (r) => r.found ?? 0,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{fmtNum(row.original.found)}</div>
        ),
      },
      {
        id: 'ingested',
        header: () => <span className="block text-right">Ingested</span>,
        accessorFn: (r) => r.ingested ?? 0,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">{fmtNum(row.original.ingested)}</div>
        ),
      },
      {
        id: 'okfail',
        header: () => <span className="block text-right">OK / Fail</span>,
        accessorFn: (r) => (r.succeeded ?? 0) - (r.failed ?? 0),
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            <span className="text-emerald-700">{row.original.succeeded ?? 0}</span>
            {' / '}
            <span className="text-rose-700">{row.original.failed ?? 0}</span>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      storageKey="runs.search"
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      emptyMessage="No search runs."
    />
  );
}
