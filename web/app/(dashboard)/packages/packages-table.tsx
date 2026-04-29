'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import { DataTable } from '@/components/dashboard/data-table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDate, fmtDuration, fmtNum, priceRange } from '@/lib/format';
import type { PackageWithStats, Platform } from '@/lib/data';

type Sp = { platform?: Platform; poi?: string; activity?: string };

function activityKey(r: PackageWithStats): string {
  return r.platform_product_id ?? `#${r.activity_id}`;
}

function activityHref(sp: Sp, r: PackageWithStats): string {
  const next = new URLSearchParams();
  if (sp.platform) next.set('platform', sp.platform);
  if (sp.poi) next.set('poi', sp.poi);
  next.set('activity', activityKey(r));
  return next.toString();
}

function mealsLabel(m: PackageWithStats['meals']): string {
  if (m === true) return 'yes';
  if (m === false) return 'no';
  return '—';
}

function langSummary(v: PackageWithStats['available_languages']): string {
  if (!v) return '—';
  let arr: unknown = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return v; }
  }
  if (!Array.isArray(arr)) return '—';
  if (arr.length === 0) return '—';
  if (arr.length <= 2) return arr.join(', ');
  return `${arr.slice(0, 2).join(', ')} +${arr.length - 2}`;
}

export function PackagesTable({
  rows,
  sp,
  emptyMessage,
}: {
  rows: PackageWithStats[];
  sp: Sp;
  emptyMessage: string;
}) {
  const columns = useMemo<ColumnDef<PackageWithStats>[]>(
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
        size: 110,
        cell: ({ row }) => (
          <span className="text-zinc-700 truncate block" title={row.original.poi ?? ''}>
            {row.original.poi ?? '—'}
          </span>
        ),
      },
      {
        id: 'activity',
        header: 'Activity ID',
        accessorFn: (r) => activityKey(r),
        size: 140,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="overflow-hidden">
              <Link
                href={`?${activityHref(sp, r)}`}
                className="font-mono text-xs text-blue-600 hover:underline tabular-nums"
                title={r.activity_title ?? ''}
              >
                {r.platform_product_id ?? `#${r.activity_id}`}
              </Link>
              <div className="truncate text-[11px] text-zinc-400" title={r.activity_title ?? ''}>
                {r.activity_title ?? '—'}
              </div>
            </div>
          );
        },
      },
      {
        id: 'package',
        header: 'Package',
        accessorFn: (r) => r.package_title ?? '',
        size: 320,
        cell: ({ row }) => (
          <div
            className="truncate font-medium"
            title={row.original.package_title ?? ''}
          >
            {row.original.package_title ?? '(untitled package)'}
          </div>
        ),
      },
      {
        id: 'tour_type',
        header: 'Tour',
        accessorFn: (r) => r.tour_type ?? '',
        size: 80,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-700">{row.original.tour_type || '—'}</span>
        ),
      },
      {
        id: 'group_size',
        header: 'Group',
        accessorFn: (r) => r.group_size ?? '',
        size: 80,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-700">{row.original.group_size || '—'}</span>
        ),
      },
      {
        id: 'meals',
        header: 'Meals',
        accessorFn: (r) => mealsLabel(r.meals),
        size: 64,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-700">{mealsLabel(row.original.meals)}</span>
        ),
      },
      {
        id: 'languages',
        header: 'Languages',
        accessorFn: (r) => langSummary(r.available_languages),
        size: 140,
        cell: ({ row }) => {
          const v = langSummary(row.original.available_languages);
          return <span className="text-xs text-zinc-700 truncate block" title={v}>{v}</span>;
        },
      },
      {
        id: 'departure',
        header: 'Departure',
        accessorFn: (r) => r.departure_city ?? '',
        size: 110,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-700 truncate block">
            {row.original.departure_city || '—'}
          </span>
        ),
      },
      {
        id: 'duration',
        header: () => <span className="block text-right">Duration</span>,
        accessorFn: (r) => r.duration_minutes ?? 0,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-xs text-zinc-600">
            {fmtDuration(row.original.duration_minutes)}
          </div>
        ),
      },
      {
        id: 'sku_count',
        header: () => <span className="block text-right">SKUs</span>,
        accessorFn: (r) => r.sku_count,
        size: 72,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{fmtNum(row.original.sku_count)}</div>
        ),
      },
      {
        id: 'usd_range',
        header: () => <span className="block text-right">USD range</span>,
        accessorFn: (r) => r.min_price_usd ?? 0,
        size: 140,
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-medium">
            {priceRange(row.original.min_price_usd, row.original.max_price_usd)}
          </div>
        ),
      },
      {
        id: 'last_checked',
        header: () => <span className="block text-right">Last</span>,
        accessorFn: (r) => r.last_checked_at ?? '',
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums text-zinc-500">
            {fmtDate(row.original.last_checked_at)}
          </div>
        ),
      },
    ],
    [sp],
  );

  return (
    <DataTable
      storageKey="packages"
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      emptyMessage={emptyMessage}
    />
  );
}
