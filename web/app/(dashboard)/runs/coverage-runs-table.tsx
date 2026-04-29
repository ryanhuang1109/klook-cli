'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDateTime, fmtNum } from '@/lib/format';
import type { CoverageRunRow } from '@/lib/data';

export function CoverageRunsTable({ rows }: { rows: CoverageRunRow[] }) {
  const columns = useMemo<ColumnDef<CoverageRunRow>[]>(
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
        id: 'poi',
        header: 'POI',
        accessorFn: (r) => r.poi ?? '',
        size: 140,
        cell: ({ row }) => row.original.poi,
      },
      {
        id: 'platform',
        header: 'Platform',
        accessorFn: (r) => r.platform,
        size: 110,
        cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
      },
      {
        id: 'filter',
        header: 'Filter',
        accessorFn: (r) => r.filter_signature ?? '',
        size: 280,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-zinc-500 truncate block" title={row.original.filter_signature}>
            {row.original.filter_signature}
          </span>
        ),
      },
      {
        id: 'fetched',
        header: () => <span className="block text-right">Fetched</span>,
        accessorFn: (r) => r.fetched ?? 0,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{fmtNum(row.original.fetched)}</div>
        ),
      },
      {
        id: 'new_unique',
        header: () => <span className="block text-right">New unique</span>,
        accessorFn: (r) => r.new_unique ?? 0,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">{fmtNum(row.original.new_unique)}</div>
        ),
      },
      {
        id: 'total_reported',
        header: () => <span className="block text-right">Total reported</span>,
        accessorFn: (r) => r.total_reported ?? 0,
        size: 130,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{fmtNum(row.original.total_reported)}</div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      storageKey="runs.coverage"
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      emptyMessage="No coverage runs."
    />
  );
}
