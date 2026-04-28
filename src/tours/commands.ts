/**
 * CLI command handlers for `tours`.
 *
 * Kept thin — each handler wires DB + an action function + console output.
 * Business logic lives in ingest.ts / export.ts / match.ts / golden.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDB } from './db.js';
import {
  ingestPricing,
  ingestFromSnapshot,
  ingestFromDetail,
  ingestBySearch,
} from './ingest.js';
import {
  exportToSheetCSV,
  buildReportSummary,
  renderHTMLReport,
} from './export.js';
import { loadGoldenCSV, uniqueActivityTargets } from './golden.js';
import { matchFromUrl } from './match.js';
import type { Platform, ReviewStatus } from './types.js';
import { loadEnv } from './env.js';

const VALID_PLATFORMS: Platform[] = ['klook', 'trip', 'kkday', 'getyourguide', 'airbnb'];
const VALID_REVIEW: ReviewStatus[] = ['unverified', 'verified', 'flagged', 'rejected'];

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function cmdIngest(opts: {
  platform: string;
  activityId: string;
  poi?: string;
  days?: number;
  url?: string;
}): Promise<void> {
  loadEnv();
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}. One of ${VALID_PLATFORMS.join(', ')}`);
  }
  const db = await openDB();
  const result = await ingestPricing(db, {
    platform: opts.platform as Platform,
    activityId: opts.activityId,
    poi: opts.poi ?? null,
    days: opts.days,
    canonicalUrl: opts.url,
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

export async function cmdIngestDetail(opts: {
  platform: string;
  activityId: string;
  poi?: string;
  url?: string;
  travelDate?: string;
  screenshot?: boolean;
  agentMode?: 'oneshot' | 'loop' | 'none';
}): Promise<void> {
  loadEnv();
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}. One of ${VALID_PLATFORMS.join(', ')}`);
  }
  const db = await openDB();
  const result = await ingestFromDetail(db, {
    platform: opts.platform as Platform,
    activityId: opts.activityId,
    poi: opts.poi ?? null,
    canonicalUrl: opts.url,
    travelDate: opts.travelDate,
    captureScreenshot: opts.screenshot,
    agentMode: opts.agentMode,
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

/**
 * High-level entry point — the form users will eventually trigger from a
 * web UI. Takes destination + keyword + competitors[], runs ingest-search on
 * each competitor sequentially, then produces CSV + HTML report.
 *
 * Search phrase = `${destination} ${keyword}`.trim().
 * POI label defaults to the keyword (or destination if keyword empty).
 */
export async function cmdRun(opts: {
  destination: string;
  keyword?: string;
  competitors: string[];
  poi?: string;
  limit?: number;
  screenshot?: boolean;
  sortBy?: 'reviews' | 'recommended';
}): Promise<void> {
  loadEnv();
  const competitors = opts.competitors.filter(
    (c) => (VALID_PLATFORMS as readonly string[]).includes(c),
  ) as Platform[];
  if (competitors.length === 0) {
    throw new Error(
      `No valid competitors. Choose from: ${VALID_PLATFORMS.join(', ')}`,
    );
  }
  const unknown = opts.competitors.filter(
    (c) => !(VALID_PLATFORMS as readonly string[]).includes(c),
  );
  if (unknown.length > 0) {
    process.stderr.write(`(ignoring unknown competitors: ${unknown.join(', ')})\n`);
  }

  const destination = opts.destination.trim();
  const keyword = (opts.keyword ?? '').trim();
  const searchPhrase = [destination, keyword].filter(Boolean).join(' ');
  if (!searchPhrase) {
    throw new Error('Either --destination or --keyword (or both) is required');
  }

  const poiLabel = opts.poi ?? (keyword || destination);
  const limit = opts.limit ?? 30;
  const sortBy = opts.sortBy ?? 'reviews';

  process.stderr.write(
    `Running on ${competitors.length} platform(s): ${competitors.join(', ')}\n`,
  );
  process.stderr.write(
    `  search="${searchPhrase}"  poi="${poiLabel}"  limit=${limit}\n\n`,
  );

  const db = await openDB();
  const summaries: Record<string, any> = {};
  const start = Date.now();

  // Create a session so every per-activity execution has a handle to group by
  const sessionId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.startSession({
    id: sessionId,
    destination,
    keyword,
    poi: poiLabel,
    competitors,
    limit,
  });
  let sessionStatus: 'done' | 'failed' = 'done';

  for (const platform of competitors) {
    process.stderr.write(`━━━ ${platform} ━━━\n`);
    try {
      const result = await ingestBySearch(db, {
        platform,
        keyword: searchPhrase,
        poi: poiLabel,
        limit,
        sortBy,
        captureScreenshot: opts.screenshot,
        onProgress: (m) => process.stderr.write(`  ${m}\n`),
        sessionId,
      });
      summaries[platform] = result;
      process.stderr.write(
        `  → ${platform}: found=${result.total_found} ingested=${result.attempted} ok=${result.succeeded} failed=${result.failed.length}\n\n`,
      );
    } catch (err) {
      summaries[platform] = { error: (err as Error).message };
      process.stderr.write(`  ! ${platform} failed: ${(err as Error).message}\n\n`);
      sessionStatus = 'failed';
    }
  }

  db.finishSession(sessionId, sessionStatus);

  // Produce CSV + HTML report automatically
  const stamp = dateStamp();
  const csvPath = path.join(process.cwd(), 'data', 'exports', `${stamp}.csv`);
  const { exportToSheetCSV, buildReportSummary, renderHTMLReport } =
    await import('./export.js');
  exportToSheetCSV(db, csvPath);
  const summary = buildReportSummary(db);
  const reportDir = path.join(process.cwd(), 'data', 'reports');
  const fs = await import('node:fs');
  fs.mkdirSync(reportDir, { recursive: true });
  const html = renderHTMLReport(
    db,
    summary,
    path.relative(reportDir, csvPath),
  );
  const htmlPath = path.join(reportDir, `${stamp}.html`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(reportDir, 'latest.html'), html);
  db.close();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    JSON.stringify(
      {
        session_id: sessionId,
        destination,
        keyword,
        search_phrase: searchPhrase,
        poi: poiLabel,
        competitors,
        elapsed_sec: elapsed,
        per_platform: summaries,
        csv: csvPath,
        html: htmlPath,
      },
      null,
      2,
    ),
  );
}

export async function cmdIngestSearch(opts: {
  platform: string;
  keyword: string;
  poi: string;
  limit?: number;
  sortBy?: 'reviews' | 'recommended';
  screenshot?: boolean;
}): Promise<void> {
  loadEnv();
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}. One of ${VALID_PLATFORMS.join(', ')}`);
  }
  const db = await openDB();
  const result = await ingestBySearch(db, {
    platform: opts.platform as Platform,
    keyword: opts.keyword,
    poi: opts.poi,
    limit: opts.limit,
    sortBy: opts.sortBy,
    captureScreenshot: opts.screenshot,
    onProgress: (m) => process.stderr.write(`→ ${m}\n`),
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

export async function cmdIngestSnapshot(opts: {
  platform: string;
  file: string;
  poi?: string;
  url?: string;
}): Promise<void> {
  const db = await openDB();
  const result = await ingestFromSnapshot(db, opts.file, {
    platform: opts.platform as Platform,
    poi: opts.poi ?? null,
    canonicalUrl: opts.url,
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}

export async function cmdIngestFromGolden(opts: {
  csv: string;
  platforms?: string[];
  days?: number;
  dryRun?: boolean;
  limit?: number;
}): Promise<void> {
  loadEnv();
  const rows = loadGoldenCSV(opts.csv);
  const targets = uniqueActivityTargets(rows);
  const filtered = targets.filter(
    (t) => !opts.platforms || opts.platforms.includes(t.platform),
  );
  const toRun = opts.limit ? filtered.slice(0, opts.limit) : filtered;

  console.log(`Found ${targets.length} unique (platform, id) targets in CSV.`);
  console.log(`Will process ${toRun.length} after filter.`);

  if (opts.dryRun) {
    for (const t of toRun) {
      const prov = t.listing_url ? `  ← ${t.listing_url}` : '';
      const who = t.discovered_by ? ` [by ${t.discovered_by}]` : '';
      console.log(`  ${t.platform} ${t.activity_id}  POI=${t.poi}  ${t.url}${prov}${who}`);
    }
    return;
  }

  const db = await openDB();
  const results: any[] = [];
  for (const t of toRun) {
    const prov = t.listing_url ? ` ← ${t.listing_url.slice(0, 40)}…` : '';
    process.stderr.write(`→ ${t.platform}/${t.activity_id} (${t.poi})${prov} ... `);
    try {
      const r = await ingestPricing(db, {
        platform: t.platform as Platform,
        activityId: t.activity_id,
        poi: t.poi,
        days: opts.days,
        canonicalUrl: t.url,
      });
      process.stderr.write(`ok (${r.skus_written} SKUs)\n`);
      results.push({ ...r, listing_url: t.listing_url, discovered_by: t.discovered_by });
    } catch (err) {
      const msg = (err as Error).message;
      process.stderr.write(`FAILED: ${msg.slice(0, 160)}\n`);
      results.push({
        platform: t.platform,
        activity_id: t.activity_id,
        error: msg,
        listing_url: t.listing_url,
        discovered_by: t.discovered_by,
      });
    }
  }
  db.close();
  console.log(JSON.stringify({ processed: results.length, results }, null, 2));
}

export async function cmdExport(opts: {
  out?: string;
  pois?: string[];
  platforms?: string[];
  date?: string;
}): Promise<void> {
  const db = await openDB();
  const outPath =
    opts.out ??
    path.join(process.cwd(), 'data', 'exports', `${dateStamp()}.csv`);
  const res = exportToSheetCSV(db, outPath, {
    pois: opts.pois,
    platforms: opts.platforms,
    date: opts.date,
  });
  db.close();
  console.log(`Wrote ${res.rowsWritten} rows → ${res.path}`);
}

export async function cmdReport(opts: { out?: string }): Promise<void> {
  const db = await openDB();
  const stamp = dateStamp();
  const csvPath = path.join(process.cwd(), 'data', 'exports', `${stamp}.csv`);
  if (!fs.existsSync(csvPath)) {
    exportToSheetCSV(db, csvPath);
  }

  const summary = buildReportSummary(db);
  const html = renderHTMLReport(db, summary, path.relative(
    path.join(process.cwd(), 'data', 'reports'),
    csvPath,
  ));
  const outPath =
    opts.out ?? path.join(process.cwd(), 'data', 'reports', `${stamp}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  // Also write latest.html for quick open
  fs.writeFileSync(path.join(path.dirname(outPath), 'latest.html'), html);
  db.close();
  console.log(JSON.stringify({ ...summary, path: outPath }, null, 2));
}

export async function cmdReviewSKU(opts: {
  sku_id: string;
  status: string;
  note?: string;
}): Promise<void> {
  if (!VALID_REVIEW.includes(opts.status as ReviewStatus)) {
    throw new Error(
      `Invalid review status: ${opts.status}. One of ${VALID_REVIEW.join(', ')}`,
    );
  }
  const db = await openDB();
  db.reviewSKU(opts.sku_id, opts.status as ReviewStatus, opts.note ?? null);
  db.close();
  console.log(`Marked SKU ${opts.sku_id} as ${opts.status}`);
}

export async function cmdReviewActivity(opts: {
  id: string;
  status: string;
  note?: string;
}): Promise<void> {
  if (!VALID_REVIEW.includes(opts.status as ReviewStatus)) {
    throw new Error(
      `Invalid review status: ${opts.status}. One of ${VALID_REVIEW.join(', ')}`,
    );
  }
  const db = await openDB();
  db.reviewActivity(opts.id, opts.status as ReviewStatus, opts.note ?? null);
  db.close();
  console.log(`Marked activity ${opts.id} as ${opts.status}`);
}

export async function cmdListActivities(opts: {
  platform?: string;
  poi?: string;
  format?: string;
}): Promise<void> {
  const db = await openDB();
  const acts = db.listActivities({ platform: opts.platform, poi: opts.poi });
  db.close();
  if (opts.format === 'json') {
    console.log(JSON.stringify(acts, null, 2));
    return;
  }
  for (const a of acts) {
    console.log(`${a.platform.padEnd(14)} ${a.platform_product_id.padEnd(12)} ${a.poi ?? ''}  ${a.title}`);
    console.log(`  ${a.canonical_url}  [${a.review_status}]`);
  }
}

export async function cmdMatchFromUrl(opts: {
  url: string;
  to: string;
  format?: string;
  model?: string;
  limit?: number;
}): Promise<void> {
  loadEnv();
  const result = await matchFromUrl(opts.url, opts.to, {
    limit: opts.limit,
    model: opts.model,
  });

  if (opts.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nSource: [${result.source.platform}] ${result.source.title}`);
  console.log(`        ${result.source.url}`);
  console.log(`\nTarget platform: ${result.target_platform}`);
  console.log(`Candidates fetched: ${result.candidates.length}`);
  console.log('\nTop matches:');
  if (result.ranked.length === 0) {
    console.log('  (none above confidence threshold)');
    return;
  }
  for (const m of result.ranked) {
    console.log(`\n  [${(m.confidence * 100).toFixed(0)}%] ${m.title}`);
    console.log(`        ${m.url}`);
    if (m.reasons.length) console.log(`        why: ${m.reasons.join(' · ')}`);
  }
}

export async function cmdIngestListing(opts: {
  file: string;
  noPricing?: boolean;
  noDetail?: boolean;
  days?: number;
  format?: string;
}): Promise<void> {
  loadEnv();
  if (!fs.existsSync(opts.file)) {
    throw new Error(`Listing file not found: ${opts.file}`);
  }
  const raw = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
  const { ingestFromListing } = await import('./listing.js');
  const db = await openDB();
  try {
    const result = await ingestFromListing(db, raw, {
      noPricing: opts.noPricing,
      noDetail: opts.noDetail,
      days: opts.days,
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const totalStr = result.total_reported == null ? '?' : String(result.total_reported);
    console.log(
      `[${result.platform}] ${result.poi}  filter="${result.filter_signature}"`,
    );
    console.log(
      `  fetched=${result.fetched}  new_unique=${result.new_unique}  total_in_filter=${totalStr}  ingested_pricing=${result.ingested_pricing}`,
    );
    if (result.failures.length) {
      console.log(`  failures (${result.failures.length}):`);
      for (const f of result.failures) {
        console.log(`    ${f.canonical_url}  ← ${f.reason}`);
      }
    }
  } finally {
    db.close();
  }
}

export async function cmdCoverageReport(opts: {
  poi?: string;
  platform?: string;
  format?: string;
}): Promise<void> {
  const { buildCoverageReport } = await import('./listing.js');
  const db = await openDB();
  try {
    const rows = buildCoverageReport(db, { poi: opts.poi, platform: opts.platform });
    if (opts.format === 'json') {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log('No coverage runs recorded yet. Run `tours ingest-listing --file <listing.json>` first.');
      return;
    }
    console.log(
      `${'POI'.padEnd(20)} ${'platform'.padEnd(14)} ${'filters'.padStart(7)} ${'unique'.padStart(7)} ${'total'.padStart(7)} ${'cov%'.padStart(6)}  last_run`,
    );
    for (const r of rows) {
      const total = r.max_total_reported == null ? '?' : String(r.max_total_reported);
      const cov = r.coverage_pct == null ? '?' : `${(r.coverage_pct * 100).toFixed(0)}%`;
      console.log(
        `${r.poi.padEnd(20)} ${r.platform.padEnd(14)} ${String(r.filter_count).padStart(7)} ${String(r.cumulative_unique).padStart(7)} ${total.padStart(7)} ${cov.padStart(6)}  ${r.last_run_at}`,
      );
    }
  } finally {
    db.close();
  }
}

export async function cmdSyncToSupabase(opts: {
  since?: string;
  dryRun?: boolean;
  format?: string;
}): Promise<void> {
  loadEnv();
  const { syncToSupabase } = await import('./supabase-sync.js');
  const db = await openDB();
  try {
    const result = await syncToSupabase(db, { since: opts.since, dryRun: opts.dryRun });
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const tag = result.dryRun ? '[dry-run] would upsert' : 'Upserted';
    console.log(`${tag} (${result.durationMs}ms):`);
    for (const [table, n] of Object.entries(result.counts)) {
      console.log(`  ${table.padEnd(18)} ${n}`);
    }
  } finally {
    db.close();
  }
}

export async function cmdVerifySupabaseSync(opts: { format?: string }): Promise<void> {
  loadEnv();
  const { verifySupabaseSync } = await import('./supabase-sync.js');
  const db = await openDB();
  try {
    const rows = await verifySupabaseSync(db);
    if (opts.format === 'json') {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log('Row count check (Supabase >= SQLite expected):');
    console.log(
      `  ${'table'.padEnd(18)} ${'sqlite'.padStart(8)} ${'supabase'.padStart(10)}  ok`,
    );
    let allOk = true;
    for (const r of rows) {
      const sb = r.supabase == null ? 'ERROR' : String(r.supabase);
      const flag = r.ok ? 'OK' : 'MISMATCH';
      if (!r.ok) allOk = false;
      console.log(
        `  ${r.table.padEnd(18)} ${String(r.sqlite).padStart(8)} ${sb.padStart(10)}  ${flag}`,
      );
    }
    if (!allOk) process.exitCode = 2;
  } finally {
    db.close();
  }
}
