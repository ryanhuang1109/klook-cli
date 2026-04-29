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
    } catch (err) {
      failed.push({ url, reason: (err as Error).message.slice(0, 200) });
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
