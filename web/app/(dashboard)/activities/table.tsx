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
import { Badge } from '@/components/ui/badge';
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
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50/50 hover:bg-zinc-50/50">
              <TableHead className="w-[88px]">Platform</TableHead>
              <TableHead>POI</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="text-right">Rating</TableHead>
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead className="text-right">Pkg / SKU</TableHead>
              <TableHead className="text-right">Price USD</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Last scrape</TableHead>
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
                <TableCell className="text-zinc-700">{r.poi ?? '—'}</TableCell>
                <TableCell className="max-w-[26rem]">
                  <div className="truncate font-medium" title={r.title ?? ''}>
                    {r.title ?? '(untitled)'}
                  </div>
                  <div className="truncate text-xs text-zinc-400 font-mono">
                    {r.platform_product_id ?? ''}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.rating == null ? '—' : Number(r.rating).toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {fmtNum(r.review_count)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-600">
                  {r.package_count ?? 0} / {r.sku_count ?? 0}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {priceRange(r.min_price_usd, r.max_price_usd)}
                </TableCell>
                <TableCell><StatusBadge status={r.review_status} /></TableCell>
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

function StatusBadge({ status }: { status: ActivityRow['review_status'] }) {
  if (!status || status === 'unverified') {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  const tone =
    status === 'verified' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
    : status === 'flagged' ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
    : 'bg-rose-100 text-rose-800 hover:bg-rose-100';
  return <Badge className={`${tone} border-transparent`}>{status}</Badge>;
}

export { fmtNum, fmtDate, fmtDuration, fmtUsd };
