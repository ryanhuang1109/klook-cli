/**
 * Pin top-N activities by review_count within (POI, platform).
 * Idempotent — only flips bits from 0 to 1; never un-pins.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';

export interface PinOptions {
  platform: Platform;
  poi: string;
  top: number;
}

export interface PinResult {
  considered: number;
  pinned: { id: string; title: string; review_count: number | null }[];
}

export async function pinTopByReviews(
  db: ToursDB,
  opts: PinOptions,
): Promise<PinResult> {
  const all = db.listActivities({ platform: opts.platform, poi: opts.poi });
  // Sort review_count DESC. NULLs last (treat null as -1 so they sort below 0).
  const ranked = [...all].sort((a, b) => {
    const ar = a.review_count ?? -1;
    const br = b.review_count ?? -1;
    return br - ar;
  });
  // Drop NULL-reviewed activities from the winners — top-N by reviews
  // means N activities that actually have reviews. Otherwise the slash
  // UX would silently pin activities with no popularity signal.
  const ranked_with_reviews = ranked.filter(
    (a) => a.review_count != null && a.review_count > 0,
  );
  const winners = ranked_with_reviews.slice(0, opts.top);
  for (const a of winners) {
    if (!a.is_pinned) db.setPinned(a.id, true);
  }
  return {
    considered: all.length,
    pinned: winners.map((a) => ({
      id: a.id,
      title: a.title,
      review_count: a.review_count,
    })),
  };
}
