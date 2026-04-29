'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtNum, fmtDate, fmtDuration, fmtUsd, priceRange } from '@/lib/format';
import type { ActivityRow } from '@/lib/data';
import { ActivityDialog } from './dialog';

export function ActivitiesTable({ rows }: { rows: ActivityRow[] }) {
  const [open, setOpen] = useState<ActivityRow | null>(null);

  const columns = useMemo<ColumnDef<ActivityRow>[]>(
    () => [
      {
        id: 'platform',
        header: 'Platform',
        size: 96,
        enableSorting: false,
        cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
      },
      {
        id: 'poi',
        header: 'POI',
        accessorFn: (r) => r.poi ?? '',
        size: 120,
        cell: ({ row }) => (
          <span className="text-zinc-700 truncate block" title={row.original.poi ?? ''}>
            {row.original.poi ?? '—'}
          </span>
        ),
      },
      {
        id: 'title',
        header: 'Title',
        accessorFn: (r) => r.title ?? '',
        size: 360,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center gap-2.5 min-w-0 w-full">
              {r.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.cover_image_url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded object-cover bg-zinc-100 shrink-0 border border-zinc-200"
                />
              ) : (
                <div className="w-10 h-10 rounded bg-zinc-100 shrink-0 border border-zinc-200" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={r.title ?? ''}>
                  {r.title ?? '(untitled)'}
                </div>
                <div className="truncate text-xs text-zinc-400 font-mono" title={r.platform_product_id ?? ''}>
                  {r.platform_product_id ?? ''}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'supplier',
        header: 'Supplier',
        accessorFn: (r) => r.supplier ?? '',
        size: 160,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-600 truncate block" title={row.original.supplier ?? ''}>
            {row.original.supplier ?? '—'}
          </span>
        ),
      },
      {
        id: 'rating',
        header: () => <span className="block text-right">Rating</span>,
        accessorFn: (r) => r.rating ?? 0,
        size: 80,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {row.original.rating == null ? '—' : Number(row.original.rating).toFixed(1)}
          </div>
        ),
      },
      {
        id: 'reviews',
        header: () => <span className="block text-right">Reviews</span>,
        accessorFn: (r) => Number(r.review_count ?? 0),
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{fmtNum(row.original.review_count)}</div>
        ),
      },
      {
        id: 'orders',
        header: () => <span className="block text-right">Orders</span>,
        accessorFn: (r) => Number(r.order_count ?? 0),
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{fmtNum(row.original.order_count)}</div>
        ),
      },
      {
        id: 'pkg',
        header: () => <span className="block text-right">Pkg</span>,
        accessorFn: (r) => r.package_count ?? 0,
        size: 64,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{row.original.package_count ?? 0}</div>
        ),
      },
      {
        id: 'sku',
        header: () => <span className="block text-right">SKU</span>,
        accessorFn: (r) => r.sku_count ?? 0,
        size: 64,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-zinc-600">{row.original.sku_count ?? 0}</div>
        ),
      },
      {
        id: 'price',
        header: () => <span className="block text-right">Price USD</span>,
        accessorFn: (r) => r.min_price_usd ?? 0,
        size: 140,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">
            {priceRange(row.original.min_price_usd, row.original.max_price_usd)}
          </div>
        ),
      },
      {
        id: 'last',
        header: () => <span className="block text-right">Last</span>,
        accessorFn: (r) => r.last_scraped_at ?? '',
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-xs text-zinc-500 tabular-nums">
            {fmtDate(row.original.last_scraped_at)}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        storageKey="activities"
        data={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={setOpen}
        emptyMessage="No activities match the filter."
      />
      <ActivityDialog activity={open} onClose={() => setOpen(null)} />
    </>
  );
}

export { fmtNum, fmtDate, fmtDuration, fmtUsd };
