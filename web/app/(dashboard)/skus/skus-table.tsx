'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import type { Platform } from '@/lib/data';
import type { PlanningRow } from '@/lib/planning';

type Sp = { platform?: Platform; poi?: string; activity?: string; page?: string };

function activityHref(sp: Sp, r: PlanningRow): string {
  const next = new URLSearchParams();
  if (sp.platform) next.set('platform', sp.platform);
  if (sp.poi) next.set('poi', sp.poi);
  if (r.product_id) next.set('activity', r.product_id);
  return next.toString();
}

function fmtCheckDate(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\..*Z?$/, '').replace('Z', '');
}

export function SkusTable({
  rows,
  sp,
  emptyMessage,
}: {
  rows: PlanningRow[];
  sp: Sp;
  emptyMessage: string;
}) {
  const columns = useMemo<ColumnDef<PlanningRow>[]>(
    () => [
      {
        id: 'ota',
        header: 'OTA',
        accessorFn: (r) => r.ota,
        size: 110,
        cell: ({ row }) => (
          <span className="text-xs font-medium">{row.original.ota}</span>
        ),
      },
      {
        id: 'main_poi',
        header: 'Main POI',
        accessorFn: (r) => r.main_poi ?? '',
        size: 120,
        cell: ({ row }) => (
          <span className="text-zinc-700 truncate block">{row.original.main_poi || '—'}</span>
        ),
      },
      {
        id: 'product_id',
        header: 'Activity ID',
        accessorFn: (r) => r.product_id ?? '',
        size: 120,
        cell: ({ row }) => (
          <Link
            href={`?${activityHref(sp, row.original)}`}
            className="font-mono text-xs text-blue-600 hover:underline tabular-nums truncate block"
            title={row.original.product_id}
          >
            {row.original.product_id || '—'}
          </Link>
        ),
      },
      {
        id: 'activity',
        header: 'Activity',
        accessorFn: (r) => r.activity_title ?? '',
        size: 280,
        cell: ({ row }) => (
          <div className="truncate text-sm" title={row.original.activity_title}>
            {row.original.activity_title || '—'}
          </div>
        ),
      },
      {
        id: 'package',
        header: 'Package',
        accessorFn: (r) => r.package ?? '',
        size: 240,
        cell: ({ row }) => (
          <div className="truncate text-xs text-zinc-700" title={row.original.package}>
            {row.original.package || '—'}
          </div>
        ),
      },
      {
        id: 'language',
        header: 'Language',
        accessorFn: (r) => r.language ?? '',
        size: 100,
        cell: ({ row }) => <span className="text-xs">{row.original.language || '—'}</span>,
      },
      {
        id: 'tour_type',
        header: 'Tour',
        accessorFn: (r) => r.tour_type ?? '',
        size: 90,
        cell: ({ row }) => <span className="text-xs">{row.original.tour_type || '—'}</span>,
      },
      {
        id: 'group',
        header: 'Group',
        accessorFn: (r) => r.group_size ?? '',
        size: 90,
        cell: ({ row }) => <span className="text-xs">{row.original.group_size || '—'}</span>,
      },
      {
        id: 'meals',
        header: 'Meals',
        accessorFn: (r) => r.meals ?? '',
        size: 80,
        cell: ({ row }) => <span className="text-xs">{row.original.meals || '—'}</span>,
      },
      {
        id: 'departure',
        header: 'Departure',
        accessorFn: (r) => r.departure_city ?? '',
        size: 120,
        cell: ({ row }) => <span className="text-xs">{row.original.departure_city || '—'}</span>,
      },
      {
        id: 'travel_date',
        header: 'Travel date',
        accessorFn: (r) => r.travel_date ?? '',
        size: 110,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-zinc-700">{row.original.travel_date || '—'}</span>
        ),
      },
      {
        id: 'check',
        header: 'Last checked',
        accessorFn: (r) => r.check_date_time ?? '',
        size: 170,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-zinc-500">{fmtCheckDate(row.original.check_date_time)}</span>
        ),
      },
      {
        id: 'usd',
        header: () => <span className="block text-right">USD</span>,
        accessorFn: (r) => parseFloat(r.price_usd) || 0,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">
            {row.original.price_usd ? `$${row.original.price_usd}` : '—'}
          </div>
        ),
      },
      {
        id: 'local',
        header: () => <span className="block text-right">Local</span>,
        accessorFn: (r) => r.price_destination_local ?? '',
        size: 120,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">
            {row.original.price_destination_local || '—'}
          </div>
        ),
      },
      {
        id: 'supplier',
        header: 'Supplier',
        accessorFn: (r) => r.supplier ?? '',
        size: 180,
        cell: ({ row }) => (
          <div className="text-xs text-zinc-600 truncate" title={row.original.supplier}>
            {row.original.supplier || '—'}
          </div>
        ),
      },
      {
        id: 'rating',
        header: () => <span className="block text-right">Rating</span>,
        accessorFn: (r) => parseFloat(r.rating) || 0,
        size: 80,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.rating || '—'}</div>
        ),
      },
      {
        id: 'reviews',
        header: () => <span className="block text-right">Reviews</span>,
        accessorFn: (r) => parseFloat((r.review_count || '').replace(/,/g, '')) || 0,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{row.original.review_count || '—'}</div>
        ),
      },
      {
        id: 'orders',
        header: () => <span className="block text-right">Orders</span>,
        accessorFn: (r) => parseFloat((r.order_count || '').replace(/,/g, '')) || 0,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{row.original.order_count || '—'}</div>
        ),
      },
      {
        id: 'lowest_url',
        header: 'Lowest URL',
        size: 120,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lowest_price_aid ? (
            <a
              href={row.original.lowest_price_aid}
              target="_blank"
              rel="noopener"
              className="text-xs text-blue-600 hover:underline truncate block"
              title={row.original.lowest_price_aid}
            >
              open ↗
            </a>
          ) : (
            <span className="text-zinc-400">—</span>
          ),
      },
    ],
    [sp],
  );

  return (
    <DataTable
      storageKey="skus"
      data={rows}
      columns={columns}
      rowKey={(r) => `${r.product_id}-${r.language}-${r.travel_date}-${r.package}`}
      emptyMessage={emptyMessage}
    />
  );
}
