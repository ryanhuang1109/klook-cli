/**
 * Pricing — refresh prices for pinned activities only. Writes skus +
 * sku_observations, never touches detail. Companion to src/tours/scan.ts.
 *
 * On empty DB the function returns { no_pinned: true } — the caller
 * (CLI / slash layer) is responsible for surfacing that to the user.
 * Never silently fall back to running scan.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';
import * as ingest from './ingest.js';

export interface RepriceOptions {
  platform: Platform;
  poi?: string;
  days?: number;
  onProgress?: (msg: string) => void;
}

export interface RepriceResult {
  no_pinned: boolean;
  attempted: number;
  succeeded: number;
  failed: { id: string; reason: string }[];
}

export async function repricePinned(
  db: ToursDB,
  opts: RepriceOptions,
): Promise<RepriceResult> {
  const pinned = db.listPinnedActivities({
    poi: opts.poi,
    platform: opts.platform,
  });
  if (pinned.length === 0) {
    return { no_pinned: true, attempted: 0, succeeded: 0, failed: [] };
  }

  const failed: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const a of pinned) {
    opts.onProgress?.(
      `${a.platform}/${a.platform_product_id} — ${(a.title ?? '').slice(0, 60)}`,
    );
    try {
      // Use canonical_url when present so URL-only platforms (GYG) get the
      // slugged path the adapter needs. Bare ids fall through unchanged.
      const activityArg = a.canonical_url || a.platform_product_id;
      await ingest.ingestPricingOnly(db, {
        platform: a.platform as Platform,
        activityId: activityArg,
        poi: a.poi ?? null,
        canonicalUrl: a.canonical_url,
        days: opts.days,
      });
      succeeded++;
    } catch (err) {
      failed.push({ id: a.id, reason: (err as Error).message.slice(0, 200) });
    }
  }

  return { no_pinned: false, attempted: pinned.length, succeeded, failed };
}
