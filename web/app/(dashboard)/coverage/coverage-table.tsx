'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDateTime } from '@/lib/format';
import type { CoverageReportRow } from '@/lib/data';

export function CoverageTable({ rows }: { rows: CoverageReportRow[] }) {
  const columns = useMemo<ColumnDef<CoverageReportRow>[]>(
    () => [
      {
        id: 'poi',
        header: 'POI',
        accessorFn: (r) => r.poi,
        size: 200,
        cell: ({ row }) => <span className="font-medium">{row.original.poi}</span>,
      },
      {
        id: 'platform',
        header: 'Platform',
        accessorFn: (r) => r.platform,
        size: 110,
        cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
      },
      {
        id: 'filters',
        header: () => <span className="block text-right">Filters</span>,
        accessorFn: (r) => r.filter_count,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{row.original.filter_count}</div>
        ),
      },
      {
        id: 'unique',
        header: () => <span className="block text-right">Unique</span>,
        accessorFn: (r) => r.cumulative_unique,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">{row.original.cumulative_unique}</div>
        ),
      },
      {
        id: 'reported',
        header: () => <span className="block text-right">Reported</span>,
        accessorFn: (r) => r.max_total_reported ?? 0,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">
            {row.original.max_total_reported ?? '—'}
          </div>
        ),
      },
      {
        id: 'coverage',
        header: () => <span className="block text-right">Coverage</span>,
        accessorFn: (r) => r.coverage_pct ?? 0,
        size: 160,
        cell: ({ row }) => <CoverageBar pct={row.original.coverage_pct} />,
      },
      {
        id: 'last',
        header: () => <span className="block text-right">Last run</span>,
        accessorFn: (r) => r.last_run_at ?? '',
        size: 180,
        cell: ({ row }) => (
          <div className="text-right text-xs text-zinc-500 font-mono">
            {fmtDateTime(row.original.last_run_at)}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      storageKey="coverage"
      data={rows}
      columns={columns}
      rowKey={(r) => `${r.poi}-${r.platform}`}
      emptyMessage="No coverage runs yet."
    />
  );
}

function CoverageBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-400 block text-right">—</span>;
  const v = Math.round(pct * 100);
  const tone =
    v >= 90 ? 'bg-emerald-500'
    : v >= 50 ? 'bg-amber-500'
    : 'bg-rose-500';
  return (
    <div className="inline-flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums font-medium text-zinc-700 w-9 text-right">
        {v}%
      </span>
    </div>
  );
}
