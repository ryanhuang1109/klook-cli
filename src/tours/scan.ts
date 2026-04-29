/**
 * Scan — discover + enrich. search → detail, NEVER writes skus.
 *
 * Broad, low-frequency. Goal: drive coverage % toward 90% per
 * (POI, platform). Pricing is the separate concern in src/tours/pricing.ts.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';
import { runSearch, ingestFromDetail, parseReviewCount } from './ingest.js';

export interface ScanOptions {
  platform: Platform;
  poi: string;
  keyword: string;
  limit?: number;
  sortBy?: 'reviews' | 'recommended';
  captureScreenshot?: boolean;
  onProgress?: (msg: string) => void;
  sessionId?: string | null;
}

export interface ScanResult {
  attempted: number;
  total_found: number;
  succeeded: number;
  failed: { url: string; reason: string }[];
}

export async function runScan(db: ToursDB, opts: ScanOptions): Promise<ScanResult> {
  const limit = opts.limit ?? 30;
  const sortBy = opts.sortBy ?? 'reviews';
  // 200 is a pragmatic cap covering 99% of POIs without blowing memory on
  // the browser-bridge platforms. Same value used by ingestBySearch.
  const COUNT_CAP = 200;

  const rawHits = runSearch(opts.platform, opts.keyword, COUNT_CAP);
  const totalFound = rawHits.length;

  const ranked = sortBy === 'reviews'
    ? [...rawHits].sort(
        (a, b) => parseReviewCount(b.review_count) - parseReviewCount(a.review_count),
      )
    : rawHits;
  const hits = ranked.slice(0, limit);

  opts.onProgress?.(
    `(fetched ${rawHits.length}, ranked by ${sortBy}, enriching top ${hits.length})`,
  );

  const failed: { url: string; reason: string }[] = [];
  let succeeded = 0;

  for (const hit of hits) {
    const url = hit.url;
    const idMatch =
      url.match(/\/activity\/(\d+)/) ||
      url.match(/detail\/(\d+)/) ||
      url.match(/product\/(\d+)/) ||
      url.match(/-t(\d+)/);
    if (!idMatch) {
      failed.push({ url, reason: 'id-not-extractable' });
      continue;
    }
    const activityId = idMatch[1];
    opts.onProgress?.(
      `${opts.platform}/${activityId} (${parseReviewCount(hit.review_count).toLocaleString()} reviews) — ${(hit.title ?? '').slice(0, 60)}`,
    );
    // Transient browser-bridge failures (e.g. "navigated or closed",
    // "Target closed") are retried once after a 4s delay, mirroring the
    // same pattern used by ingestBySearch. Anything non-transient or that
    // fails on the second attempt is recorded in `failed` immediately.
    const TRANSIENT_RE = /navigated or closed|target closed|session closed|ERR_NETWORK|Execution context was destroyed/i;
    const maxAttempts = 2;
    let lastErr: string | null = null;
    let done = false;

    for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
      try {
        await ingestFromDetail(db, {
          platform: opts.platform,
          activityId,
          poi: opts.poi,
          canonicalUrl: url,
          captureScreenshot: opts.captureScreenshot,
          sessionId: opts.sessionId,
        });
        succeeded++;
        done = true;
      } catch (err) {
        lastErr = (err as Error).message.slice(0, 200);
        if (attempt < maxAttempts && TRANSIENT_RE.test(lastErr)) {
          opts.onProgress?.(
            `  ↻ transient error on ${opts.platform}/${activityId}, retrying in 4s…`,
          );
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        failed.push({ url, reason: lastErr });
        done = true;
      }
    }
  }

  db.logSearchRun({
    platform: opts.platform,
    keyword: opts.keyword,
    poi: opts.poi,
    total_found: totalFound,
    ingested: hits.length,
    succeeded,
    failed: failed.length,
  });

  return {
    attempted: hits.length,
    total_found: totalFound,
    succeeded,
    failed,
  };
}
