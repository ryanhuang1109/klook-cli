'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/dashboard/platform-badge';
import { fmtDate, fmtDuration, fmtNum, fmtUsd, priceRange } from '@/lib/format';
import type { ActivityRow, PackageRow, SkuRow } from '@/lib/data';
import { getPackagesAndSkus } from './actions';

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
        {activity ? <DialogBody activity={activity} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({ activity }: { activity: ActivityRow }) {
  const extras = parseExtras(activity.raw_extras_json);
  const hasExtras = extras && Object.keys(extras).length > 0;

  return (
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
        <div className="aspect-video bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activity.cover_image_url}
            alt={activity.title ?? ''}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="packages">Packages &amp; SKUs</TabsTrigger>
          {activity.description ? (
            <TabsTrigger value="description">Description</TabsTrigger>
          ) : null}
          {activity.screenshot_url ? (
            <TabsTrigger value="screenshot">Screenshot</TabsTrigger>
          ) : null}
          {hasExtras ? <TabsTrigger value="extras">Raw extras</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview"><OverviewTab activity={activity} /></TabsContent>
        <TabsContent value="packages"><PackagesTab activityId={activity.id} /></TabsContent>
        {activity.description ? (
          <TabsContent value="description">
            <DescriptionTab text={activity.description} />
          </TabsContent>
        ) : null}
        {activity.screenshot_url ? (
          <TabsContent value="screenshot">
            <ScreenshotTab url={activity.screenshot_url} />
          </TabsContent>
        ) : null}
        {hasExtras ? (
          <TabsContent value="extras">
            <pre className="bg-zinc-900 text-zinc-100 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-96">
              {JSON.stringify(extras, null, 2)}
            </pre>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function OverviewTab({ activity }: { activity: ActivityRow }) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Activity meta
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
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
  );
}

function PackagesTab({ activityId }: { activityId: number }) {
  const [data, setData] = useState<{ packages: PackageRow[]; skus: SkuRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setData(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await getPackagesAndSkus(activityId);
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [activityId]);

  if (error) {
    return <p className="text-sm text-rose-700">Error: {error}</p>;
  }
  if (data === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (data.packages.length === 0) {
    return (
      <p className="text-sm text-zinc-500 italic">
        No packages — pricing run produced no rows for this activity (check Executions for diagnosis).
      </p>
    );
  }

  const skusByPkg = new Map<number, SkuRow[]>();
  for (const s of data.skus) {
    if (!skusByPkg.has(s.package_id)) skusByPkg.set(s.package_id, []);
    skusByPkg.get(s.package_id)!.push(s);
  }

  return (
    <div className="space-y-3">
      {data.packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} skus={skusByPkg.get(pkg.id) ?? []} />
      ))}
    </div>
  );
}

function PackageCard({ pkg, skus }: { pkg: PackageRow; skus: SkuRow[] }) {
  const subtitleBits = [
    pkg.tour_type,
    pkg.group_size,
    pkg.meals === true ? 'meals included' : pkg.meals === false ? 'no meals' : null,
    pkg.departure_city,
    pkg.departure_time,
    pkg.duration_minutes ? fmtDuration(pkg.duration_minutes) : null,
  ].filter(Boolean);

  const langs = parseList(pkg.available_languages);
  const inclusions = parseList(pkg.inclusions);
  const exclusions = parseList(pkg.exclusions);
  const sortedSkus = [...skus].sort((a, b) =>
    (a.travel_date ?? '').localeCompare(b.travel_date ?? ''),
  );

  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-sm">{pkg.title ?? '(untitled)'}</div>
          {subtitleBits.length > 0 ? (
            <div className="text-xs text-zinc-500 mt-0.5">{subtitleBits.join(' · ')}</div>
          ) : null}
          {langs && langs.length > 0 ? (
            <div className="text-xs text-zinc-500 mt-0.5">
              Languages: {langs.join(', ')}
            </div>
          ) : null}
        </div>
        {pkg.platform_package_id ? (
          <div className="text-xs text-zinc-500 font-mono">pkg {pkg.platform_package_id}</div>
        ) : null}
      </div>

      {(inclusions && inclusions.length > 0) || (exclusions && exclusions.length > 0) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-xs">
          {inclusions && inclusions.length > 0 ? (
            <div>
              <div className="text-zinc-500 uppercase tracking-wide font-semibold mb-1">
                Inclusions ({inclusions.length})
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-zinc-700">
                {inclusions.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : null}
          {exclusions && exclusions.length > 0 ? (
            <div>
              <div className="text-zinc-500 uppercase tracking-wide font-semibold mb-1">
                Exclusions ({exclusions.length})
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-zinc-700">
                {exclusions.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {sortedSkus.length === 0 ? (
        <div className="text-xs text-zinc-500 italic mt-3">No SKUs.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 mt-3">
          {sortedSkus.map((s) => {
            const tone = !s.available
              ? 'bg-zinc-100 text-zinc-400 line-through'
              : 'bg-white border border-zinc-200';
            const price =
              s.price_usd != null
                ? `$${Number(s.price_usd).toFixed(2)}`
                : s.price_local != null
                  ? `${s.price_local} ${s.currency ?? ''}`
                  : '—';
            return (
              <div
                key={s.id}
                className={`${tone} rounded px-2 py-1.5 text-xs`}
                title={s.last_checked_at ? `last checked ${s.last_checked_at}` : ''}
              >
                <div className="text-zinc-500">{s.travel_date}</div>
                <div className="font-mono font-medium">{price}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DescriptionTab({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(text.length <= 320);
  return (
    <section>
      <div
        className={`bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed ${expanded ? '' : 'max-h-40 overflow-hidden relative'}`}
      >
        {text}
      </div>
      {text.length > 320 ? (
        <button
          type="button"
          className="mt-2 text-xs text-blue-600 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : 'Show full description'}
        </button>
      ) : null}
    </section>
  );
}

function ScreenshotTab({ url }: { url: string }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-500">Captured during the last scrape.</span>
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="text-xs text-blue-600 hover:underline"
        >
          Open full size →
        </a>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="block bg-zinc-100 rounded-lg overflow-hidden border border-zinc-200 max-h-[60vh]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Page screenshot"
          referrerPolicy="no-referrer"
          className="w-full h-auto"
        />
      </a>
    </section>
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

function parseList(v: string[] | string | null | undefined): string[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseExtras(v: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
