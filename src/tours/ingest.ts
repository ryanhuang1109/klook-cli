/**
 * Orchestrates a full scrape → normalize → store cycle.
 *
 * Shells out to the existing `opencli <platform> pricing <id>` commands (which
 * already return SKU-level rows) and pipes the output through the normalizer.
 *
 * Snapshots of raw JSON are written to data/snapshots/ for post-mortem when
 * normalization or the scraper itself returns partial data.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToursDB } from './db.js';
import type { Platform, PricingRunRaw, PricingRowRaw } from './types.js';
import { normalizePricingRun } from './normalize.js';
import { urlForLanguage, applyDefaultLanguage } from './url-locale.js';
// Self-import so that vi.spyOn(ingest, 'runPricingRaw') / vi.spyOn(ingest, 'ingestFromDetail')
// can intercept intra-module calls in vitest's ESM environment.
import * as ingestSelf from './ingest.js';

/**
 * Pragmatic ceiling for `runSearch` over-fetch. Covers ~99% of POIs
 * without blowing memory on browser-bridge platforms (each result
 * carries DOM-extracted fields). Used by both `runScan` (catalog) and
 * legacy `ingestBySearch` (coupled flow).
 */
export const SEARCH_COUNT_CAP = 200;

function stripOpencliNoise(output: string): string {
  return output
    .split('\n')
    .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
    .join('\n');
}

export interface SearchHit {
  title: string;
  url: string;
  price?: string;
  rating?: string;
  review_count?: string;
}

export function runSearch(
  platform: Platform,
  keyword: string,
  limit = 20,
): SearchHit[] {
  const output = execFileSync(
    'opencli',
    [platform, 'search', keyword, '--limit', String(limit), '-f', 'json'],
    { encoding: 'utf-8', timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
  );
  const results = JSON.parse(stripOpencliNoise(output));
  if (!Array.isArray(results)) return [];
  return results as SearchHit[];
}

/**
 * Extract a numeric review count from the various string shapes search APIs
 * return — "29.2K", "1,234 reviews", "(539)", "" → number or 0 when unparseable.
 */
export function parseReviewCount(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.replace(/,/g, '').match(/([\d.]+)\s*([kKmM])?/);
  if (!m) return 0;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return 0;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') return Math.round(base * 1_000);
  if (suffix === 'm') return Math.round(base * 1_000_000);
  return Math.round(base);
}

export async function ingestBySearch(
  db: ToursDB,
  opts: {
    platform: Platform;
    keyword: string;
    poi: string;
    limit?: number;
    /** How many to over-fetch so we can rank by review count before ingesting. Default 3× limit. */
    fetchMultiplier?: number;
    /** Sort candidates before ingesting: 'reviews' (default) ranks by review_count desc, 'recommended' keeps API order. */
    sortBy?: 'reviews' | 'recommended';
    captureScreenshot?: boolean;
    onProgress?: (msg: string) => void;
    sessionId?: string | null;
  },
): Promise<{ attempted: number; total_found: number; succeeded: number; failed: { url: string; reason: string }[] }> {
  const limit = opts.limit ?? 30;
  const sortBy = opts.sortBy ?? 'reviews';

  // Probe the search with a HIGH cap so `total_found` reflects the real
  // population the platform returns for this keyword — not the ingest limit.
  // The same fetched list feeds the re-rank + slice, so this is one call.
  const rawHits = runSearch(opts.platform, opts.keyword, SEARCH_COUNT_CAP);
  const totalFound = rawHits.length;

  let ranked: SearchHit[];
  if (sortBy === 'reviews') {
    ranked = [...rawHits].sort(
      (a, b) => parseReviewCount(b.review_count) - parseReviewCount(a.review_count),
    );
  } else {
    ranked = rawHits;
  }

  const hits = ranked.slice(0, limit);
  const failed: { url: string; reason: string }[] = [];
  let succeeded = 0;

  opts.onProgress?.(
    `(fetched ${rawHits.length}, ranked by ${sortBy}, ingesting top ${hits.length})`,
  );

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
      `${opts.platform}/${activityId} (${parseReviewCount(hit.review_count).toLocaleString()} reviews) — ${hit.title.slice(0, 60)}`,
    );

    // Transient browser-bridge failures — mostly seen on Trip.com where the
    // detail page re-renders mid-scrape — surface as "navigated or closed"
    // / "Target closed" / "Session closed". Spawn-level timeouts
    // (`spawnSync opencli ETIMEDOUT`) on slow detail pages are also
    // retryable. Retry once with a 4s delay to let the bridge settle.
    // Anything else fails immediately.
    const TRANSIENT_RE = /navigated or closed|target closed|session closed|ERR_NETWORK|Execution context was destroyed|ETIMEDOUT|spawnSync .* timed? ?out/i;
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
        // Either non-transient or out of retries
        failed.push({ url, reason: lastErr });
        db.logExecution({
          session_id: opts.sessionId ?? null,
          platform: opts.platform,
          activity_id: activityId,
          strategy: 'opencli-detail',
          duration_ms: 0,
          succeeded: 0,
          error_message: lastErr,
          packages_written: 0,
          skus_written: 0,
          fallback_reason: null,
        });
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

  return { attempted: hits.length, total_found: totalFound, succeeded, failed };
}

export interface IngestOptions {
  platform: Platform;
  activityId: string;
  poi?: string | null;
  days?: number;
  canonicalUrl?: string;
  snapshotDir?: string;
  /**
   * ISO language code (e.g. "en", "zh-tw", "pa"). When set, the URL handed
   * to opencli is rewritten to that locale (see src/tours/url-locale.ts) so
   * platforms like GYG return the package set for that language.
   */
  language?: string;
  /**
   * When true (default), fall back to `ingestFromDetail` automatically if the
   * pricing scraper crashes or returns zero captured days. Set false to keep
   * the legacy "fail loudly" behavior.
   */
  detailFallback?: boolean;
}

export interface IngestResult {
  activityId: string;
  platform: Platform;
  /** Real count of SKU rows that were inserted or updated in SQLite. */
  skus_written: number;
  /** Real count of package rows that were inserted or updated. */
  packages_written: number;
  /** Real count of sku_observations rows appended (history table). 0 here
   *  alongside non-zero `skus_written` is the smoking gun for the silent-
   *  write class of bug (e.g. zh-TW cookie + GYG normalizer). */
  observations_appended: number;
  /** Real count of activity rows updated/inserted (1 or 0). */
  activity_written: boolean;
  warnings: string[];
  snapshot_path: string;
}

export function runPricingRaw(
  platform: Platform,
  activityId: string,
  days = 7,
): PricingRunRaw {
  const output = execFileSync(
    'opencli',
    [platform, 'pricing', activityId, '--days', String(days), '-f', 'json'],
    { encoding: 'utf-8', timeout: 300_000, maxBuffer: 50 * 1024 * 1024 },
  );

  const jsonStr = output
    .split('\n')
    .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
    .join('\n');

  const parsed = JSON.parse(jsonStr);
  if (!parsed || !Array.isArray(parsed.rows)) {
    throw new Error(
      `opencli ${platform} pricing returned no rows for ${activityId}`,
    );
  }
  return parsed as PricingRunRaw;
}

function snapshotPath(dir: string, platform: string, activityId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // activityId may be a bare id, a URL, or a slugged URL — strip anything
  // that would create a subdirectory or otherwise break a flat filename.
  const safe = activityId.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  return path.join(dir, `${platform}-${safe}-${stamp}.json`);
}

/**
 * Merge `existing.raw_extras_json` into `normalized.raw_extras_json` so that
 * re-ingesting an activity (e.g. running `tours ingest-detail` without
 * `--screenshot`) doesn't overwrite previously-stored extras like
 * `screenshot_url`. New fields take precedence; old fields the new scrape
 * didn't surface are preserved.
 *
 * Mutates `normalized.activity.raw_extras_json` in place.
 */
/**
 * Merge new and existing `available_languages` for a single package so a
 * second ingest under a different locale doesn't overwrite the first
 * locale's record. Result is a deduped union, preserving order of first
 * seen.
 */
function mergePackageLanguages(
  newPkg: { available_languages: unknown },
  existing: { available_languages: unknown } | null | undefined,
): void {
  const oldList = Array.isArray(existing?.available_languages)
    ? (existing!.available_languages as string[])
    : [];
  const newList = Array.isArray(newPkg.available_languages)
    ? (newPkg.available_languages as string[])
    : [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const v of [...oldList, ...newList]) {
    if (v && !seen.has(v)) {
      seen.add(v);
      merged.push(v);
    }
  }
  newPkg.available_languages = merged;
}

function mergeRawExtras(
  normalized: { activity: { raw_extras_json: string } },
  existing: { raw_extras_json: string } | null,
): void {
  if (!existing?.raw_extras_json) return;
  let oldX: Record<string, unknown> = {};
  let newX: Record<string, unknown> = {};
  try { oldX = JSON.parse(existing.raw_extras_json); } catch { return; }
  try { newX = JSON.parse(normalized.activity.raw_extras_json || '{}'); } catch { return; }
  normalized.activity.raw_extras_json = JSON.stringify({ ...oldX, ...newX });
}

export async function ingestPricingOnly(
  db: ToursDB,
  opts: Omit<IngestOptions, 'detailFallback'>,
): Promise<IngestResult & { captured_days: number }> {
  const snapshotDir =
    opts.snapshotDir ?? path.join(process.cwd(), 'data', 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  // When a language is specified, rewrite URL-shaped activity ids to that
  // locale so the opencli adapter renders the language-specific package
  // set. Otherwise apply the platform's default-language policy (e.g.
  // airbnb defaults to ?locale=en-US so we don't end up with mixed-locale
  // descriptions when the Browser Bridge cookie isn't en-US). Bare ids
  // fall through unchanged.
  let opencliArg: string;
  if (opts.activityId.startsWith('http')) {
    opencliArg = opts.language
      ? urlForLanguage(opts.platform, opts.activityId, opts.language)
      : applyDefaultLanguage(opts.platform, opts.activityId);
  } else {
    opencliArg = opts.activityId;
  }

  // No try/catch — let exceptions bubble up to the caller.
  // Call through ingestSelf so vi.spyOn(ingest, 'runPricingRaw') can intercept in tests.
  const raw = ingestSelf.runPricingRaw(opts.platform, opencliArg, opts.days ?? 7);

  const snapPath = snapshotPath(snapshotDir, opts.platform, opts.activityId);
  fs.writeFileSync(snapPath, JSON.stringify(raw, null, 2));

  const normalized = normalizePricingRun(raw, {
    platform: opts.platform,
    poi: opts.poi ?? null,
    canonicalUrl: opts.canonicalUrl,
  });

  const existing = db.getActivity(normalized.activity.id);
  if (existing) {
    normalized.activity.first_scraped_at = existing.first_scraped_at;
  }
  mergeRawExtras(normalized, existing);
  const activityWritten = db.upsertActivity(normalized.activity);

  // Look up existing packages for this activity once, build a map by id,
  // and use it to merge language arrays before upsert. Without this, a
  // re-ingest under a different locale would overwrite the available_languages
  // column instead of unioning.
  const priorPkgsByIdA = new Map(
    db.listPackagesForActivity(normalized.activity.id).map((p) => [p.id, p]),
  );
  let pkgsChanged = 0;
  for (const pkg of normalized.packages.values()) {
    mergePackageLanguages(pkg as any, priorPkgsByIdA.get(pkg.id) as any);
    if (db.upsertPackage(pkg)) pkgsChanged++;
  }

  let skusChanged = 0;
  for (const sku of normalized.skus) {
    if (db.upsertSKU(sku)) skusChanged++;
  }
  let obsAppended = 0;
  for (const obs of normalized.observations) {
    if (db.appendObservation(obs)) obsAppended++;
  }

  // Surface silent normalizer/db failures: the result reports actual DB
  // writes, not the optimistic `normalized.*.length` counters that masked
  // the GYG zh-TW regression.
  const warnings = [...normalized.warnings];
  if (normalized.observations.length > 0 && obsAppended === 0) {
    warnings.push(
      `silent-write: normalizer produced ${normalized.observations.length} observations but 0 reached the DB. ` +
      `Likely cause: schema/regex mismatch in normalize.ts. Inspect snapshot: ${snapPath}`,
    );
  }

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: skusChanged,
    packages_written: pkgsChanged,
    observations_appended: obsAppended,
    activity_written: activityWritten,
    warnings,
    snapshot_path: snapPath,
    captured_days: raw.days_captured,
  };
}

export async function ingestPricing(
  db: ToursDB,
  opts: IngestOptions,
): Promise<IngestResult & { captured_days: number }> {
  const fallbackEnabled = opts.detailFallback !== false;
  let result: IngestResult & { captured_days: number };
  let pricingThrew: Error | null = null;

  try {
    // Call through ingestSelf so vi.spyOn can intercept in tests.
    result = await ingestSelf.ingestPricingOnly(db, opts);
  } catch (err) {
    if (!fallbackEnabled) throw err;
    pricingThrew = err as Error;
    // Fake-result so we trigger the empty-fallback branch below.
    result = {
      activityId: opts.activityId,
      platform: opts.platform,
      skus_written: 0,
      packages_written: 0,
      observations_appended: 0,
      activity_written: false,
      warnings: [],
      snapshot_path: '',
      captured_days: 0,
    };
  }

  // No usable data and fallback enabled → defer to ingestFromDetail.
  // Detail fallback writes its own snapshot (`-detail.json`) so we don't
  // duplicate the broken pricing snapshot if it exists.
  // Post-normalize check: trigger fallback when 0 SKUs landed in the DB
  // even though pricing was reachable. This is broader than the original
  // raw-row check (which only saw `raw.rows.length === 0`) — it also
  // catches the normalize-filtered-everything case (e.g. zh-TW DOM that
  // runPricingRaw captured but the price-parse regex couldn't normalize).
  // The trade-off: we recover with detail data instead of returning empty,
  // at the cost of masking normalizer bugs. The silent-write warning in
  // ingestPricingOnly still fires for skus_written===0, so the smell is
  // not lost — it's only that the activity row gets populated by detail
  // rather than left empty.
  const noUsableRows = result.skus_written === 0;
  if (fallbackEnabled && (result.captured_days === 0 || noUsableRows)) {
    // Call through ingestSelf so vi.spyOn(ingest, 'ingestFromDetail') can intercept in tests.
    const detailResult = await ingestSelf.ingestFromDetail(db, {
      platform: opts.platform,
      activityId: opts.activityId,
      poi: opts.poi ?? null,
      canonicalUrl: opts.canonicalUrl,
    });
    const reason = pricingThrew
      ? `pricing-threw: ${pricingThrew.message.slice(0, 160)}`
      : result.captured_days === 0
        ? `pricing-empty (days_captured=0)`
        : `pricing-no-skus (captured_days=${result.captured_days}, skus_written=0)`;
    return {
      ...detailResult,
      captured_days: 0,
      warnings: [...detailResult.warnings, `auto-fallback to ingestFromDetail; ${reason}`],
    };
  }

  return result;
}

/**
 * Fallback path: shell out to `opencli <platform> detail <id>`, turn the
 * detail output into a single-date PricingRunRaw and ingest. Use when the
 * pricing scraper is broken or when you only need the current advertised
 * price (not a multi-day matrix). Travel date defaults to today; completeness
 * flags will show "missing: multi-date" on the packages.
 */
export function detailToPricingRun(
  platform: Platform,
  activityId: string,
  detail: any,
  travelDate: string,
): PricingRunRaw {
  const checkedAt = new Date().toISOString();
  const rows: PricingRowRaw[] = [];
  const packages = Array.isArray(detail?.packages) ? detail.packages : [];

  // Dedupe by package name + price — detail often emits duplicate entries
  const seen = new Set<string>();
  let idx = 0;
  for (const p of packages) {
    const key = `${p.name ?? ''}|${p.price ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const priceStr = (p.price ?? '').toString();
    const priceMatch = priceStr.match(/([A-Z]{2,3}|[¥€£$])\s*([\d,]+(?:\.\d+)?)/);
    const currency = (priceMatch?.[1] ?? p.currency ?? '').replace('$', '').trim() || 'USD';
    const priceNum = priceMatch?.[2]?.replace(/,/g, '') ?? '';

    rows.push({
      ota: platform,
      activity_id: activityId,
      activity_title: detail?.title ?? '',
      activity_url: detail?.url ?? '',
      date: travelDate,
      check_date_time_gmt8: checkedAt,
      package_id: `detail-${idx++}`,
      package_name: p.name ?? '(unnamed)',
      group_title: p.name ?? '',
      price: priceNum,
      currency,
      original_price: p.original_price ?? '',
      availability: p.availability ?? 'Available',
    });
  }

  return {
    activity_id: activityId,
    ota: platform,
    url: detail?.url ?? '',
    title: detail?.title ?? '',
    days_requested: 1,
    days_captured: rows.length > 0 ? 1 : 0,
    rows,
    errors: rows.length === 0 ? [{ reason: 'detail-returned-no-packages' }] : undefined,
  };
}

export async function ingestFromDetail(
  db: ToursDB,
  opts: {
    platform: Platform;
    activityId: string;
    poi?: string | null;
    canonicalUrl?: string;
    travelDate?: string;
    captureScreenshot?: boolean;
    sessionId?: string | null;
    /**
     * When opencli's DOM scrape returns 0 packages, use either a single-shot
     * LLM extraction ('oneshot') or a multi-turn agent loop that can click
     * dropdowns/tabs ('loop'). Default is 'oneshot' for cost reasons.
     */
    agentMode?: 'oneshot' | 'loop' | 'none';
    /**
     * ISO language hint. When set, the URL handed to opencli is rewritten to
     * that locale via src/tours/url-locale.ts. GYG is the only platform
     * implementing the rewrite today; others ignore.
     */
    language?: string;
  },
): Promise<IngestResult> {
  const execStart = Date.now();
  let execError: string | null = null;
  let execPkgs = 0;
  let execSkus = 0;
  const snapshotDir = path.join(process.cwd(), 'data', 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  // Prefer the full canonical URL when available — important for GetYourGuide
  // where the ID-only URL (`/activity/t123/`) is a synthetic fallback, not the
  // real slug path (`/city-l1/title-t123/`), and can fail to resolve reliably.
  const baseDetailArg = opts.canonicalUrl?.startsWith('http')
    ? opts.canonicalUrl
    : opts.activityId;
  // Locale rewrite. Caller's language hint wins; otherwise apply the
  // platform's default-language policy (airbnb → en-US so descriptions
  // come back in English even under a zh-TW Browser Bridge cookie).
  let detailArg: string;
  if (baseDetailArg.startsWith('http')) {
    detailArg = opts.language
      ? urlForLanguage(opts.platform, baseDetailArg, opts.language)
      : applyDefaultLanguage(opts.platform, baseDetailArg);
  } else {
    detailArg = baseDetailArg;
  }

  const output = execFileSync(
    'opencli',
    [opts.platform, 'detail', detailArg, '-f', 'json'],
    { encoding: 'utf-8', timeout: 180_000, maxBuffer: 50 * 1024 * 1024 },
  );
  const jsonStr = output
    .split('\n')
    .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
    .join('\n');
  const detail = JSON.parse(jsonStr);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const travelDate = opts.travelDate ?? tomorrow.toISOString().slice(0, 10);

  const raw = detailToPricingRun(opts.platform, opts.activityId, detail, travelDate);

  // Use the shared snapshotPath helper to sanitise activityId — when this
  // is a URL (always the case for GYG, sometimes elsewhere) the raw value
  // would push the snapshot file into nonexistent subdirectories.
  const snapPath = snapshotPath(snapshotDir, opts.platform, opts.activityId)
    .replace(/\.json$/, '-detail.json');
  fs.writeFileSync(snapPath, JSON.stringify({ source: 'detail', detail_raw: detail, normalized: raw }, null, 2));

  let screenshotPath: string | null = null;
  let screenshotUrl: string | null = null;
  if (opts.captureScreenshot) {
    try {
      const { captureAndUploadScreenshot } = await import('./screenshot-upload.js');
      const url = opts.canonicalUrl ?? detail?.url ?? `https://www.${opts.platform}.com`;
      const r = await captureAndUploadScreenshot(url, opts.platform, opts.activityId, {
        scrollTimes: 1,
      });
      screenshotPath = r.localPath;
      screenshotUrl = r.publicUrl;
    } catch (err) {
      // Screenshot is best-effort — don't fail the ingest
      console.error(`(screenshot failed for ${opts.platform}/${opts.activityId}: ${(err as Error).message.slice(0, 160)})`);
    }
  }

  // Inject screenshot path + Supabase Storage URL into detail so the
  // normalizer stores them as raw_extras. The dashboard reads
  // raw_extras_json -> screenshot_url to render the audit thumbnail.
  let detailWithShot: any = screenshotPath
    ? { ...detail, screenshot_path: path.relative(process.cwd(), screenshotPath), screenshot_url: screenshotUrl }
    : detail;

  // ── Agent-browser fallback ─────────────────────────────────────────
  // If opencli's DOM-selector scrape returned no packages, call the LLM
  // fallback to try again using the visible page content. The raw result
  // is merged into the pricing run as additional rows so the normalizer
  // downstream treats them uniformly.
  let agentFallbackUsed = false;
  let agentFallbackReason: string | null = null;
  const agentMode = opts.agentMode ?? 'oneshot';
  if (raw.rows.length === 0 && agentMode !== 'none') {
    agentFallbackReason = 'opencli-returned-no-packages';
    const agentStart = Date.now();
    try {
      let agentRows: PricingRowRaw[] = [];
      let agentSupplier = '';
      let agentLangs = '';
      let agentOrders = '';
      let agentNotes = '';
      let agentScreenshot: string | null = null;

      if (agentMode === 'loop') {
        const { runAgentLoop } = await import('./agent-loop.js');
        const r = await runAgentLoop({
          platform: opts.platform,
          url: opts.canonicalUrl ?? detail?.url ?? '',
          activity_id: opts.activityId,
          activity_title: detail?.title,
        });
        agentRows = r.rows;
        agentSupplier = r.supplier;
        agentLangs = r.languages_header;
        agentOrders = r.order_count;
        agentNotes = `[loop · ${r.rounds.length} rounds · ${r.confidence ?? 'unknown'} confidence] ${r.notes}`;
        agentScreenshot = r.screenshot_path;
      } else {
        const { runAgentFallback } = await import('./agent-fallback.js');
        const r = await runAgentFallback({
          platform: opts.platform,
          url: opts.canonicalUrl ?? detail?.url ?? '',
          activity_id: opts.activityId,
          activity_title: detail?.title,
        });
        agentRows = r.rows;
        agentSupplier = r.supplier;
        agentLangs = r.languages_header;
        agentOrders = r.order_count;
        agentNotes = `[oneshot] ${r.notes}`;
        agentScreenshot = r.screenshot_path;
      }

      raw.rows = agentRows;
      raw.days_captured = agentRows.length > 0 ? 1 : 0;
      detailWithShot = {
        ...detailWithShot,
        supplier: detailWithShot.supplier || agentSupplier,
        bookCount: detailWithShot.bookCount || agentOrders,
        languagesHeader: detailWithShot.languagesHeader || agentLangs,
        agent_fallback_used: true,
        agent_fallback_mode: agentMode,
        agent_fallback_notes: agentNotes,
      };
      if (agentScreenshot && !detailWithShot.screenshot_path) {
        detailWithShot.screenshot_path = path.relative(process.cwd(), agentScreenshot);
      }
      agentFallbackUsed = agentRows.length > 0;

      db.logExecution({
        session_id: opts.sessionId ?? null,
        platform: opts.platform,
        activity_id: opts.activityId,
        strategy: 'agent-browser-fallback',
        duration_ms: Date.now() - agentStart,
        succeeded: agentRows.length > 0 ? 1 : 0,
        error_message: agentRows.length === 0 ? 'agent-also-returned-no-packages' : null,
        packages_written: 0,
        skus_written: 0,
        fallback_reason: `${agentFallbackReason}:${agentMode}`,
      });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 200);
      db.logExecution({
        session_id: opts.sessionId ?? null,
        platform: opts.platform,
        activity_id: opts.activityId,
        strategy: 'agent-browser-fallback',
        duration_ms: Date.now() - agentStart,
        succeeded: 0,
        error_message: msg,
        packages_written: 0,
        skus_written: 0,
        fallback_reason: `${agentFallbackReason}:${agentMode}`,
      });
    }
  }

  const normalized = normalizePricingRun(raw, {
    platform: opts.platform,
    poi: opts.poi ?? null,
    canonicalUrl: opts.canonicalUrl ?? detail?.url,
    detailRaw: detailWithShot,
  });

  const existing = db.getActivity(normalized.activity.id);
  if (existing) normalized.activity.first_scraped_at = existing.first_scraped_at;
  mergeRawExtras(normalized, existing);
  const activityWrittenD = db.upsertActivity(normalized.activity);
  const priorDPkgsById = new Map(
    db.listPackagesForActivity(normalized.activity.id).map((p) => [p.id, p]),
  );
  let pkgsChangedD = 0;
  for (const pkg of normalized.packages.values()) {
    mergePackageLanguages(pkg as any, priorDPkgsById.get(pkg.id) as any);
    if (db.upsertPackage(pkg)) pkgsChangedD++;
  }
  let skusChangedD = 0;
  for (const sku of normalized.skus) {
    if (db.upsertSKU(sku)) skusChangedD++;
  }
  let obsAppendedD = 0;
  for (const obs of normalized.observations) {
    if (db.appendObservation(obs)) obsAppendedD++;
  }

  execPkgs = pkgsChangedD;
  execSkus = skusChangedD;

  db.logExecution({
    session_id: opts.sessionId ?? null,
    platform: opts.platform,
    activity_id: opts.activityId,
    strategy: agentFallbackUsed ? 'agent-browser-fallback' : 'opencli-detail',
    duration_ms: Date.now() - execStart,
    succeeded: execPkgs > 0 ? 1 : 0,
    error_message: execPkgs === 0 ? 'no-packages-extracted' : null,
    packages_written: execPkgs,
    skus_written: execSkus,
    fallback_reason: agentFallbackUsed ? agentFallbackReason : null,
  });

  const warningsD = [...normalized.warnings];
  if (normalized.observations.length > 0 && obsAppendedD === 0) {
    warningsD.push(
      `silent-write: normalizer produced ${normalized.observations.length} observations but 0 reached the DB. ` +
      `Inspect snapshot: ${snapPath}`,
    );
  }

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: skusChangedD,
    packages_written: pkgsChangedD,
    observations_appended: obsAppendedD,
    activity_written: activityWrittenD,
    warnings: warningsD,
    snapshot_path: snapPath,
  };
}

export async function ingestFromSnapshot(
  db: ToursDB,
  snapshotFile: string,
  opts: { platform: Platform; poi?: string | null; canonicalUrl?: string },
): Promise<IngestResult> {
  const raw = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8')) as PricingRunRaw;
  const normalized = normalizePricingRun(raw, {
    platform: opts.platform,
    poi: opts.poi ?? null,
    canonicalUrl: opts.canonicalUrl,
  });

  const existing = db.getActivity(normalized.activity.id);
  if (existing) {
    normalized.activity.first_scraped_at = existing.first_scraped_at;
  }
  mergeRawExtras(normalized, existing);
  const activityWrittenS = db.upsertActivity(normalized.activity);
  const priorSPkgsById = new Map(
    db.listPackagesForActivity(normalized.activity.id).map((p) => [p.id, p]),
  );
  let pkgsChangedS = 0;
  for (const pkg of normalized.packages.values()) {
    mergePackageLanguages(pkg as any, priorSPkgsById.get(pkg.id) as any);
    if (db.upsertPackage(pkg)) pkgsChangedS++;
  }
  let skusChangedS = 0;
  for (const sku of normalized.skus) {
    if (db.upsertSKU(sku)) skusChangedS++;
  }
  let obsAppendedS = 0;
  for (const obs of normalized.observations) {
    if (db.appendObservation(obs)) obsAppendedS++;
  }

  const warningsS = [...normalized.warnings];
  if (normalized.observations.length > 0 && obsAppendedS === 0) {
    warningsS.push(
      `silent-write: normalizer produced ${normalized.observations.length} observations but 0 reached the DB. ` +
      `Inspect snapshot: ${snapshotFile}`,
    );
  }

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: skusChangedS,
    packages_written: pkgsChangedS,
    observations_appended: obsAppendedS,
    activity_written: activityWrittenS,
    warnings: warningsS,
    snapshot_path: snapshotFile,
  };
}
