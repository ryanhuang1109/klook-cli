'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtNum, fmtDate, fmtDuration, fmtUsd, priceRange } from '@/lib/format';
import type { ActivityRow } from '@/lib/data';
import { ActivityDialog } from './dialog';

export function ActivitiesTable({ rows }: { rows: ActivityRow[] }) {
  const [open, setOpen] = useState<ActivityRow | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-sm text-zinc-500">
        No activities match the filter.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
              <TableHead className="w-[88px]">Platform</TableHead>
              <TableHead className="w-[120px]">POI</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-[160px]">Supplier</TableHead>
              <TableHead className="w-[64px] text-right">Rating</TableHead>
              <TableHead className="w-[80px] text-right">Reviews</TableHead>
              <TableHead className="w-[80px] text-right">Orders</TableHead>
              <TableHead className="w-[56px] text-right">Pkg</TableHead>
              <TableHead className="w-[56px] text-right">SKU</TableHead>
              <TableHead className="w-[140px] text-right">Price USD</TableHead>
              <TableHead className="w-[100px] text-right">Last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => setOpen(r)}
                className="cursor-pointer"
              >
                <TableCell><PlatformBadge platform={r.platform} /></TableCell>
                <TableCell className="text-zinc-700 truncate" title={r.poi ?? ''}>
                  {r.poi ?? '—'}
                </TableCell>
                <TableCell className="overflow-hidden">
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
                </TableCell>
                <TableCell className="text-xs text-zinc-600 truncate" title={r.supplier ?? ''}>
                  {r.supplier ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.rating == null ? '—' : Number(r.rating).toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {fmtNum(r.review_count)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {fmtNum(r.order_count)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {r.package_count ?? 0}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {r.sku_count ?? 0}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {priceRange(r.min_price_usd, r.max_price_usd)}
                </TableCell>
                <TableCell className="text-right text-xs text-zinc-500 tabular-nums">
                  {fmtDate(r.last_scraped_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ActivityDialog
        activity={open}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

export { fmtNum, fmtDate, fmtDuration, fmtUsd };
