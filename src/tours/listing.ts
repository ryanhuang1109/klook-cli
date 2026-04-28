/**
 * Listing-driven ingest with coverage tracking.
 *
 * The caller (a colleague's listing-page skill, a manual JSON file, or a
 * future adapter) hands us a Listing payload describing a filtered slice of
 * activities for one (POI, platform, filter). We:
 *   1. dedupe canonical_url against the activities table
 *   2. ingest pricing for the new ones (unless --no-pricing)
 *   3. write a coverage_runs row so we can compute saturation later
 *
 * We deliberately do NOT generate the listing here — that's someone else's
 * job. The contract is intentionally minimal so any source can produce it.
 */
import { z } from 'zod';
import type { ToursDB } from './db.js';
import { PlatformEnum } from './types.js';
import type { Platform } from './types.js';
import { ingestPricing, ingestFromDetail } from './ingest.js';

export const ListingActivitySchema = z.object({
  canonical_url: z.string().url(),
  platform_product_id: z.string().optional(),
  title: z.string().optional(),
});

export const ListingSchema = z.object({
  poi: z.string().min(1),
  platform: PlatformEnum,
  /** Caller-defined free-form key. Used as a coverage axis identity, never parsed. */
  filter_signature: z.string().min(1),
  /** Total reported by the listing source's filter header. null when unknown. */
  total_in_filter: z.number().int().nonnegative().nullable().default(null),
  activities: z.array(ListingActivitySchema),
});
export type Listing = z.infer<typeof ListingSchema>;

export interface IngestListingOptions {
  /** Skip pricing/detail fetch — just dedupe and log coverage. */
  noPricing?: boolean;
  /** Skip the detail-level fetch (supplier / cancellation / description). */
  noDetail?: boolean;
  /** Skip the page-screenshot capture + upload (default: capture). */
  noScreenshot?: boolean;
  /** Days of pricing matrix per new activity (default 7). */
  days?: number;
}

export interface IngestListingResult {
  poi: string;
  platform: Platform;
  filter_signature: string;
  total_reported: number | null;
  fetched: number;
  new_unique: number;
  ingested_pricing: number;
  failures: { canonical_url: string; reason: string }[];
}

/**
 * Idempotent listing ingest. Re-running the same listing JSON is safe — the
 * dedupe step ensures we never re-scrape activities we already have, and a
 * second coverage_runs row will simply show new_unique=0.
 */
export async function ingestFromListing(
  db: ToursDB,
  raw: unknown,
  opts: IngestListingOptions = {},
): Promise<IngestListingResult> {
  const listing = ListingSchema.parse(raw);

  // Dedupe against existing activities.
  const knownUrls = new Set(db.listActivities().map((a) => a.canonical_url));
  const incoming = listing.activities;
  const newOnes = incoming.filter((a) => !knownUrls.has(a.canonical_url));

  const failures: { canonical_url: string; reason: string }[] = [];
  let ingestedPricing = 0;

  if (!opts.noPricing) {
    for (const a of newOnes) {
      // Prefer the canonical URL — every adapter accepts full URLs, but
      // GetYourGuide rejects bare ids (it needs the `/city-lXXX/...-tXXX/`
      // path to hydrate locale + ranking context). Falling back to the
      // bare id is fine for the rare case where the listing source omitted
      // the URL.
      const idForOpencli = a.canonical_url ?? a.platform_product_id;

      // Run detail FIRST so the activity row gets supplier / cancellation_
      // policy / description / order_count populated. Detail failure is
      // non-fatal — pricing still runs and writes the activity row with
      // whatever fields it can populate. Skip when --no-detail is passed.
      // Screenshots are captured + uploaded to Supabase Storage so coworkers
      // have an audit trail of what we actually saw on the page.
      if (!opts.noDetail) {
        try {
          await ingestFromDetail(db, {
            platform: listing.platform,
            activityId: idForOpencli,
            poi: listing.poi,
            canonicalUrl: a.canonical_url,
            agentMode: 'none',
            captureScreenshot: !opts.noScreenshot,
          });
        } catch (err) {
          // Surface but don't bail — pricing path is the higher-value
          // fetch and worth attempting even when detail flunked.
          failures.push({
            canonical_url: a.canonical_url,
            reason: 'detail: ' + (err as Error).message.slice(0, 180),
          });
        }
      }

      try {
        await ingestPricing(db, {
          platform: listing.platform,
          activityId: idForOpencli,
          poi: listing.poi,
          days: opts.days,
          canonicalUrl: a.canonical_url,
        });
        ingestedPricing += 1;
      } catch (err) {
        failures.push({
          canonical_url: a.canonical_url,
          reason: 'pricing: ' + (err as Error).message.slice(0, 180),
        });
      }
    }
  }

  // Coverage run logged regardless of pricing success — its job is to record
  // *what the listing said*, not what we successfully scraped downstream.
  db.logCoverageRun({
    poi: listing.poi,
    platform: listing.platform,
    filter_signature: listing.filter_signature,
    total_reported: listing.total_in_filter,
    fetched: incoming.length,
    new_unique: newOnes.length,
  });

  return {
    poi: listing.poi,
    platform: listing.platform,
    filter_signature: listing.filter_signature,
    total_reported: listing.total_in_filter,
    fetched: incoming.length,
    new_unique: newOnes.length,
    ingested_pricing: ingestedPricing,
    failures,
  };
}

export interface CoverageReportRow {
  poi: string;
  platform: string;
  filter_count: number;
  cumulative_unique: number;
  max_total_reported: number | null;
  coverage_pct: number | null;
  last_run_at: string;
}

/**
 * Per (POI, platform) saturation summary. cumulative_unique = unique
 * canonical_urls in `activities` for that (POI, platform). coverage_pct =
 * cumulative_unique / max(total_reported across all filters) when totals are
 * known; null otherwise (still useful — caller can see absolute counts).
 */
export function buildCoverageReport(
  db: ToursDB,
  filters: { poi?: string; platform?: string } = {},
): CoverageReportRow[] {
  const runs = db.listCoverageRuns(filters);
  // For activity lookups we ignore the poi filter (do it ourselves below) so
  // that case-insensitive matching works even when the caller filters by a
  // specific casing.
  const activities = db.listActivities({ platform: filters.platform });

  // POI casing is not yet canonicalised at write time — `activities.poi` is
  // historically lowercase ('mt fuji') while listing inputs may use display
  // casing ('Mt Fuji'). Normalise here so the join doesn't silently produce
  // unique=0 when both sides clearly refer to the same POI.
  const groupKey = (poi: string, platform: string) =>
    `${poi.trim().toLowerCase()}::${platform}`;

  const byGroup = new Map<
    string,
    { poi: string; platform: string; runs: typeof runs }
  >();
  for (const r of runs) {
    const k = groupKey(r.poi, r.platform);
    if (!byGroup.has(k)) byGroup.set(k, { poi: r.poi, platform: r.platform, runs: [] });
    byGroup.get(k)!.runs.push(r);
  }

  const cumulativeByGroup = new Map<string, number>();
  for (const a of activities) {
    if (!a.poi) continue;
    const k = groupKey(a.poi, a.platform);
    cumulativeByGroup.set(k, (cumulativeByGroup.get(k) ?? 0) + 1);
  }

  const out: CoverageReportRow[] = [];
  for (const [k, g] of byGroup) {
    const totals = g.runs
      .map((r) => r.total_reported)
      .filter((n): n is number => n != null);
    const max_total_reported = totals.length ? Math.max(...totals) : null;
    const cumulative_unique = cumulativeByGroup.get(k) ?? 0;
    const coverage_pct =
      max_total_reported && max_total_reported > 0
        ? Math.min(1, cumulative_unique / max_total_reported)
        : null;
    const last_run_at = g.runs[0].run_at; // listCoverageRuns is DESC
    out.push({
      poi: g.poi,
      platform: g.platform,
      filter_count: new Set(g.runs.map((r) => r.filter_signature)).size,
      cumulative_unique,
      max_total_reported,
      coverage_pct,
      last_run_at,
    });
  }
  out.sort((a, b) => a.poi.localeCompare(b.poi) || a.platform.localeCompare(b.platform));
  return out;
}
