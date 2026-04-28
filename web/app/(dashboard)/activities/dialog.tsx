'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDate, fmtDuration, fmtNum, fmtUsd, priceRange } from '@/lib/format';
import type { ActivityRow } from '@/lib/data';

export function ActivityDialog({
  activity,
  onClose,
}: {
  activity: ActivityRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!activity} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto sm:!max-w-5xl">
        {activity ? (
          <div className="space-y-5">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <PlatformBadge platform={activity.platform} />
                <span className="text-xs text-zinc-400 font-mono break-all">
                  id {activity.platform_product_id}
                </span>
              </div>
              <DialogTitle className="text-xl leading-tight pr-6">
                {activity.title ?? '(untitled)'}
              </DialogTitle>
              {activity.canonical_url ? (
                <a
                  href={activity.canonical_url}
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-blue-600 hover:underline break-all block"
                >
                  {activity.canonical_url}
                </a>
              ) : null}
            </DialogHeader>

            {activity.cover_image_url ? (
              <section>
                <div className="aspect-video bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activity.cover_image_url}
                    alt={activity.title ?? ''}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              </section>
            ) : null}

            {activity.screenshot_url ? (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Scrape screenshot
                  </h3>
                  <a
                    href={activity.screenshot_url}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Open full size →
                  </a>
                </div>
                <a
                  href={activity.screenshot_url}
                  target="_blank"
                  rel="noopener"
                  className="block bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200 max-h-96"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activity.screenshot_url}
                    alt="Page screenshot"
                    referrerPolicy="no-referrer"
                    className="w-full h-auto"
                  />
                </a>
              </section>
            ) : null}

            <section className="space-y-1">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Activity meta
              </div>
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm pt-2">
                <Cell label="POI" value={activity.poi} />
                <Cell label="Supplier" value={activity.supplier} />
                <Cell
                  label="Rating"
                  value={
                    activity.rating == null
                      ? null
                      : `${Number(activity.rating).toFixed(2)} (${fmtNum(activity.review_count)} reviews)`
                  }
                />
                <Cell label="Orders" value={fmtNum(activity.order_count)} />
                <Cell label="Duration" value={fmtDuration(activity.duration_minutes)} />
                <Cell label="Departure city" value={activity.departure_city} />
                <Cell label="Packages" value={String(activity.package_count ?? 0)} />
                <Cell label="SKUs" value={String(activity.sku_count ?? 0)} />
                <Cell
                  label="Price USD range"
                  value={priceRange(activity.min_price_usd, activity.max_price_usd)}
                />
                <Cell
                  label="Avg avail USD"
                  value={activity.avg_avail_usd == null ? null : fmtUsd(activity.avg_avail_usd)}
                />
                <Cell label="First scraped" value={fmtDate(activity.first_scraped_at)} />
                <Cell label="Last scraped" value={fmtDate(activity.last_scraped_at)} />
              </dl>
            </section>

            {activity.review_note ? (
              <TextSection
                label="Review note"
                value={activity.review_note}
                tone="bg-amber-50 border-amber-200 text-amber-900"
              />
            ) : null}
            {activity.cancellation_policy ? (
              <TextSection
                label="Cancellation policy"
                value={activity.cancellation_policy}
              />
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Cell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums break-words mt-0.5">
        {value == null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

function TextSection({
  label,
  value,
  tone = 'bg-zinc-50 border-zinc-200 text-zinc-800',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <section>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
        {label}
      </div>
      <div className={`text-sm rounded-lg border p-3 whitespace-pre-wrap ${tone}`}>
        {value}
      </div>
    </section>
  );
}
