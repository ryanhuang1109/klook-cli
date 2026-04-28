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
function parseReviewCount(raw: string | undefined): number {
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
  // 200 is a pragmatic ceiling that covers 99% of POIs without blowing out
  // memory on the browser-bridge platforms.
  const COUNT_CAP = 200;
  const rawHits = runSearch(opts.platform, opts.keyword, COUNT_CAP);
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
    // / "Target closed" / "Session closed". Retry once with a 4s delay to
    // let the bridge settle. Anything else fails immediately.
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
}

export interface IngestResult {
  activityId: string;
  platform: Platform;
  skus_written: number;
  packages_written: number;
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

export async function ingestPricing(
  db: ToursDB,
  opts: IngestOptions,
): Promise<IngestResult> {
  const snapshotDir =
    opts.snapshotDir ?? path.join(process.cwd(), 'data', 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  const raw = runPricingRaw(opts.platform, opts.activityId, opts.days ?? 7);

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
  db.upsertActivity(normalized.activity);

  for (const pkg of normalized.packages.values()) {
    db.upsertPackage(pkg);
  }

  for (const sku of normalized.skus) {
    db.upsertSKU(sku);
  }
  for (const obs of normalized.observations) {
    db.appendObservation(obs);
  }

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: normalized.skus.length,
    packages_written: normalized.packages.size,
    warnings: normalized.warnings,
    snapshot_path: snapPath,
  };
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
  const detailArg = opts.canonicalUrl?.startsWith('http')
    ? opts.canonicalUrl
    : opts.activityId;

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

  const snapPath = path.join(
    snapshotDir,
    `${opts.platform}-${opts.activityId}-detail-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
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
  db.upsertActivity(normalized.activity);
  for (const pkg of normalized.packages.values()) db.upsertPackage(pkg);
  for (const sku of normalized.skus) db.upsertSKU(sku);
  for (const obs of normalized.observations) db.appendObservation(obs);

  execPkgs = normalized.packages.size;
  execSkus = normalized.skus.length;

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

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: execSkus,
    packages_written: execPkgs,
    warnings: normalized.warnings,
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
  db.upsertActivity(normalized.activity);
  for (const pkg of normalized.packages.values()) db.upsertPackage(pkg);
  for (const sku of normalized.skus) db.upsertSKU(sku);
  for (const obs of normalized.observations) db.appendObservation(obs);

  return {
    activityId: normalized.activity.id,
    platform: opts.platform,
    skus_written: normalized.skus.length,
    packages_written: normalized.packages.size,
    warnings: normalized.warnings,
    snapshot_path: snapshotFile,
  };
}
