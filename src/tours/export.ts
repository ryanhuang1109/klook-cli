/**
 * Exporters: DB → CSV (matches user's planning sheet) and DB → HTML report.
 *
 * The CSV intentionally produces one row per (SKU × language) to match how
 * the user's existing sheet is laid out. When a package has no detected
 * language, we emit a single row with language="—" so nothing is silently
 * dropped.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToursDB, ExportRow, ActivitySummaryRow } from './db.js';
// path imported above; used below in relative() for screenshot URLs


const PLATFORM_LABELS: Record<string, string> = {
  klook: 'Klook',
  trip: 'Trip.com',
  kkday: 'KKday',
  getyourguide: 'GetYourGuide',
};

function csvField(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Flatten raw_extras JSON to a short "k=v; k=v" string for the Notes column.
 * Skip long arrays; truncate long strings. Keeps the CSV human-readable.
 */
export function summarizeExtras(rawJson: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(rawJson || '{}');
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;

    // option_dimensions is the high-signal one — expand each dimension
    if (k === 'option_dimensions' && Array.isArray(v)) {
      for (const d of v as { label?: string; options?: unknown[] }[]) {
        const label = d.label ?? 'option';
        const opts = Array.isArray(d.options) ? (d.options as string[]).slice(0, 6) : [];
        if (opts.length > 0) parts.push(`${label}=[${opts.join('|')}]`);
      }
      continue;
    }

    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      if (v.length <= 3 && v.every((x) => typeof x === 'string' && x.length < 60)) {
        parts.push(`${k}=[${v.join('|')}]`);
      } else {
        parts.push(`${k}=(${v.length} items)`);
      }
    } else if (typeof v === 'object') {
      parts.push(`${k}=(obj)`);
    } else {
      const s = String(v);
      parts.push(`${k}=${s.length > 80 ? s.slice(0, 77) + '…' : s}`);
    }
  }
  return parts.join('; ');
}

function formatLocalPrice(price: number | null, currency: string | null): string {
  if (price == null) return '';
  const sym =
    currency === 'JPY' ? '¥' :
    currency === 'HKD' || currency === 'HK' ? 'HK$' :
    currency === 'TWD' ? 'NT$' :
    currency === 'KRW' ? '₩' :
    currency === 'USD' || currency === 'US' ? '$' :
    currency === 'EUR' ? '€' :
    currency === 'GBP' ? '£' :
    currency ? currency + ' ' : '';
  const formatted =
    currency === 'JPY' || currency === 'KRW'
      ? Math.round(price).toLocaleString('en-US')
      : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${formatted}`;
}

export interface SheetExportOptions {
  pois?: string[];
  platforms?: string[];
  date?: string;
}

export function exportToSheetCSV(
  db: ToursDB,
  outPath: string,
  opts: SheetExportOptions = {},
): { rowsWritten: number; path: string } {
  const all = db.listAllRowsForExport();
  const filtered = all.filter((r) => {
    if (opts.pois && r.poi && !opts.pois.includes(r.poi)) return false;
    if (opts.platforms && !opts.platforms.includes(r.platform)) return false;
    if (opts.date && r.travel_date !== opts.date) return false;
    return true;
  });

  // Product ID + Activity Title moved to columns 2 & 3 so each row
  // makes clear which parent product the package belongs to.
  const header = [
    'OTA',
    'Product ID',
    'Activity Title',
    'Main POI',
    'Language',
    'Tour Type',
    'Group size',
    'Meals',
    'Departure City',
    'Departure time',
    'Travel Date',
    'Check Date_Time (GMT+8)',
    'Lowest_Price_AID',
    'Price_USD',
    'Price_Destination_Local',
    'Supplier',
    'Package',
    'Rating',
    'Review Count',
    'Order Count',
    'Notes (platform extras)',
    'SKU Review',
  ];

  const acts = new Map<string, ActivitySummaryRow>();
  for (const a of db.listActivitySummaries()) acts.set(a.id, a);

  const lines: string[] = [header.map(csvField).join(',')];
  let rowsWritten = 0;

  for (const r of filtered) {
    const langs = JSON.parse(r.available_languages || '[]') as string[];
    const langList = langs.length ? langs : ['—'];

    const actSummary = acts.get(r.activity_id);
    const extras = actSummary ? summarizeExtras(actSummary.raw_extras_json) : '';

    for (const lang of langList) {
      lines.push(
        [
          PLATFORM_LABELS[r.platform] ?? r.platform,
          // Prefer the platform-native product id (e.g. 151477) for human use;
          // fall back to the full canonical id if something odd happened
          actSummary?.platform_product_id ?? r.activity_id,
          r.title,
          r.poi ?? '',
          lang,
          r.tour_type,
          r.group_size,
          r.meals == null ? '' : r.meals ? 'Yes' : 'No',
          r.departure_city_pkg || r.departure_city_activity || '',
          r.departure_time || '',
          r.travel_date,
          r.last_checked_at,
          r.canonical_url,
          r.price_usd != null ? r.price_usd.toFixed(2) : '',
          formatLocalPrice(r.price_local, r.currency),
          r.supplier || '',
          r.package_title,
          actSummary?.rating != null ? actSummary.rating.toFixed(1) : '',
          actSummary?.review_count ?? '',
          actSummary?.order_count ?? '',
          extras,
          r.sku_review_status,
        ].map(csvField).join(','),
      );
      rowsWritten++;
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));

  // Also write a stable `latest.csv` alongside the dated file. Vercel's static
  // build picks this up and serves it at /csv so BD links stay valid.
  const latestPath = path.join(path.dirname(outPath), 'latest.csv');
  fs.writeFileSync(latestPath, lines.join('\n'));

  return { rowsWritten, path: outPath };
}

export interface ReportSummary {
  generated_at: string;
  activity_count: number;
  package_count: number;
  sku_count: number;
  sku_with_price: number;
  sku_with_usd: number;
  platforms: { platform: string; activities: number; skus: number }[];
  completeness_flags: {
    missing_supplier: number;
    missing_departure_time: number;
    unknown_tour_type: number;
    no_language_detected: number;
    no_usd_conversion: number;
  };
  review: {
    activities_verified: number;
    activities_flagged: number;
    skus_verified: number;
    skus_flagged: number;
  };
  price_variance_warnings: Array<{
    activity_id: string;
    package_title: string;
    travel_date: string;
    variance_pct: number;
  }>;
}

export function buildReportSummary(db: ToursDB): ReportSummary {
  const rows = db.listAllRowsForExport();
  const activities = new Set<string>();
  const pkgs = new Set<string>();
  const platformStats = new Map<string, { activities: Set<string>; skus: number }>();
  let skuCount = 0;
  let skuWithPrice = 0;
  let skuWithUsd = 0;

  const missingSupplier = new Set<string>();
  const missingDeparture = new Set<string>();
  const unknownTour = new Set<string>();
  const noLang = new Set<string>();
  let noUsd = 0;

  let actVerified = 0;
  let actFlagged = 0;
  let skuVerified = 0;
  let skuFlagged = 0;

  const seenAct = new Set<string>();

  for (const r of rows) {
    activities.add(r.activity_id);
    pkgs.add(r.package_id);
    skuCount++;
    if (r.price_local != null) skuWithPrice++;
    if (r.price_usd != null) skuWithUsd++;
    else noUsd++;

    const ps = platformStats.get(r.platform) ?? { activities: new Set(), skus: 0 };
    ps.activities.add(r.activity_id);
    ps.skus++;
    platformStats.set(r.platform, ps);

    if (!r.supplier) missingSupplier.add(r.activity_id);
    if (!r.departure_time) missingDeparture.add(r.package_id);
    if (r.tour_type === 'Unknown') unknownTour.add(r.package_id);
    if (!r.available_languages || r.available_languages === '[]') noLang.add(r.package_id);

    if (!seenAct.has(r.activity_id)) {
      seenAct.add(r.activity_id);
      if (r.activity_review_status === 'verified') actVerified++;
      if (r.activity_review_status === 'flagged') actFlagged++;
    }
    if (r.sku_review_status === 'verified') skuVerified++;
    if (r.sku_review_status === 'flagged') skuFlagged++;
  }

  return {
    generated_at: new Date().toISOString(),
    activity_count: activities.size,
    package_count: pkgs.size,
    sku_count: skuCount,
    sku_with_price: skuWithPrice,
    sku_with_usd: skuWithUsd,
    platforms: Array.from(platformStats.entries())
      .map(([platform, s]) => ({
        platform,
        activities: s.activities.size,
        skus: s.skus,
      }))
      .sort((a, b) => b.skus - a.skus),
    completeness_flags: {
      missing_supplier: missingSupplier.size,
      missing_departure_time: missingDeparture.size,
      unknown_tour_type: unknownTour.size,
      no_language_detected: noLang.size,
      no_usd_conversion: noUsd,
    },
    review: {
      activities_verified: actVerified,
      activities_flagged: actFlagged,
      skus_verified: skuVerified,
      skus_flagged: skuFlagged,
    },
    price_variance_warnings: [],
  };
}

export function renderHTMLReport(
  db: ToursDB,
  summary: ReportSummary,
  csvRelPath: string,
): string {
  const rows = db.listAllRowsForExport().slice(0, 200);
  const activities = db.listActivitySummaries();
  const searchRuns = db.listSearchRuns({ sinceHoursAgo: 48 });
  const sessions = db.listSessions({ limit: 10 });
  const recentExecutions = db.listRecentExecutions({ sinceHoursAgo: 48, limit: 50 });

  const activityRows = activities
    .map((a) => {
      const priceRange =
        a.min_price_usd != null && a.max_price_usd != null
          ? a.min_price_usd === a.max_price_usd
            ? `$${a.min_price_usd.toFixed(2)}`
            : `$${a.min_price_usd.toFixed(2)}–$${a.max_price_usd.toFixed(2)}`
          : '—';

      let heroImage = '';
      let badges: string[] = [];
      let screenshotPath: string | null = null;
      try {
        const extras = JSON.parse(a.raw_extras_json || '{}');
        if (typeof extras.first_image === 'string') heroImage = extras.first_image;
        if (Array.isArray(extras.badges)) badges = extras.badges.slice(0, 3);
        if (typeof extras.screenshot_path === 'string') screenshotPath = extras.screenshot_path;
      } catch { /* ignore */ }

      const shotHref = screenshotPath ? path.relative(path.join(process.cwd(), 'data', 'reports'), path.join(process.cwd(), screenshotPath)) : null;
      const imgCell = heroImage
        ? `<a href="${escapeAttr(a.canonical_url)}" target="_blank"><img class="hero" src="${escapeAttr(heroImage)}" alt="" /></a>
           ${shotHref ? `<a class="screenshot-link" href="${escapeAttr(shotHref)}" target="_blank">📸 screenshot</a>` : ''}`
        : `<div class="hero placeholder">no image</div>
           ${shotHref ? `<a class="screenshot-link" href="${escapeAttr(shotHref)}" target="_blank">📸 screenshot</a>` : ''}`;

      const badgeHTML = badges
        .map((b) => `<span class="badge">${escapeHtml(b)}</span>`)
        .join(' ');

      // Data attributes drive the client-side filters below the h2 headings.
      return `<tr data-poi="${escapeAttr(a.poi ?? '')}" data-platform="${escapeAttr(a.platform)}">
        <td class="img-cell">${imgCell}</td>
        <td>${PLATFORM_LABELS[a.platform] ?? a.platform}</td>
        <td>${a.poi ?? ''}</td>
        <td class="title-cell">
          <a href="${escapeAttr(a.canonical_url)}" target="_blank">${escapeHtml(a.title)}</a>
          ${badgeHTML ? `<div class="badges">${badgeHTML}</div>` : ''}
        </td>
        <td class="small">${a.platform_product_id}</td>
        <td class="num">${a.rating != null ? '★ ' + a.rating.toFixed(1) : '—'}</td>
        <td class="num">${a.review_count != null ? a.review_count.toLocaleString() : '—'}</td>
        <td class="num">${a.order_count != null ? a.order_count.toLocaleString() : '—'}</td>
        <td class="num">${a.package_count}</td>
        <td class="num">${a.sku_count}</td>
        <td class="num">${priceRange}</td>
        <td class="small">${a.review_status}</td>
      </tr>`;
    })
    .join('');

  // Collect unique facets for the filter dropdowns. Sort alphabetically for
  // stable rendering across runs.
  const uniquePois = Array.from(new Set(activities.map((a) => a.poi).filter(Boolean))) as string[];
  uniquePois.sort();
  const uniquePlatforms = Array.from(new Set(activities.map((a) => a.platform)));
  uniquePlatforms.sort();

  const platformRows = summary.platforms
    .map(
      (p) =>
        `<tr><td>${PLATFORM_LABELS[p.platform] ?? p.platform}</td><td class="num">${p.activities}</td><td class="num">${p.skus}</td></tr>`,
    )
    .join('');

  // ── Per-POI aggregate + POI × Platform cross-tab ─────────────────
  // Aggregate the activity summary we already have. No extra DB round trip.
  type Cell = { activities: number; skus: number };
  const byPoi = new Map<string, Cell>();
  const cross = new Map<string, Map<string, Cell>>();
  const platformTotals = new Map<string, Cell>();

  for (const a of activities) {
    const poiKey = a.poi ?? '(no POI)';

    const poiCell = byPoi.get(poiKey) ?? { activities: 0, skus: 0 };
    poiCell.activities += 1;
    poiCell.skus += a.sku_count;
    byPoi.set(poiKey, poiCell);

    if (!cross.has(poiKey)) cross.set(poiKey, new Map());
    const row = cross.get(poiKey)!;
    const cell = row.get(a.platform) ?? { activities: 0, skus: 0 };
    cell.activities += 1;
    cell.skus += a.sku_count;
    row.set(a.platform, cell);

    const tot = platformTotals.get(a.platform) ?? { activities: 0, skus: 0 };
    tot.activities += 1;
    tot.skus += a.sku_count;
    platformTotals.set(a.platform, tot);
  }

  const poiOrder = Array.from(byPoi.keys()).sort();
  const platformOrder = Array.from(platformTotals.keys()).sort();

  const perPoiRows = poiOrder
    .map((poi) => {
      const c = byPoi.get(poi)!;
      return `<tr><td>${escapeHtml(poi)}</td><td class="num">${c.activities}</td><td class="num">${c.skus}</td></tr>`;
    })
    .join('');

  // Cross-tab: each cell shows "activities / skus". Empty cells show —.
  const crossHeader =
    `<th>POI</th>` +
    platformOrder
      .map((p) => `<th>${escapeHtml(PLATFORM_LABELS[p] ?? p)}</th>`)
      .join('') +
    `<th>Total</th>`;

  const crossBody = poiOrder
    .map((poi) => {
      const row = cross.get(poi)!;
      const total = byPoi.get(poi)!;
      const cells = platformOrder
        .map((p) => {
          const c = row.get(p);
          return c
            ? `<td class="num" title="${c.activities} activit${c.activities === 1 ? 'y' : 'ies'} · ${c.skus} SKU${c.skus === 1 ? '' : 's'}"><strong>${c.activities}</strong> <span class="small">/ ${c.skus}</span></td>`
            : `<td class="num small">—</td>`;
        })
        .join('');
      return `<tr>
        <td>${escapeHtml(poi)}</td>
        ${cells}
        <td class="num"><strong>${total.activities}</strong> <span class="small">/ ${total.skus}</span></td>
      </tr>`;
    })
    .join('');

  const crossFooter =
    `<tr><td><strong>Total</strong></td>` +
    platformOrder
      .map((p) => {
        const t = platformTotals.get(p)!;
        return `<td class="num"><strong>${t.activities}</strong> <span class="small">/ ${t.skus}</span></td>`;
      })
      .join('') +
    `<td class="num"><strong>${activities.length}</strong> <span class="small">/ ${activities.reduce((s, a) => s + a.sku_count, 0)}</span></td></tr>`;

  // Index activities so each package row can cite its parent product ID + title
  const actIndex = new Map<string, { product_id: string; title: string }>();
  for (const a of activities) actIndex.set(a.id, { product_id: a.platform_product_id, title: a.title });

  const dataRows = rows
    .map((r) => {
      const langs = JSON.parse(r.available_languages || '[]') as string[];
      const act = actIndex.get(r.activity_id);
      return `<tr data-poi="${escapeAttr(r.poi ?? '')}" data-platform="${escapeAttr(r.platform)}">
        <td class="small mono">${act?.product_id ?? r.activity_id}</td>
        <td class="small">${escapeHtml((act?.title ?? '').slice(0, 60))}${act && act.title.length > 60 ? '…' : ''}</td>
        <td>${PLATFORM_LABELS[r.platform] ?? r.platform}</td>
        <td>${r.poi ?? ''}</td>
        <td>${escapeHtml(r.package_title)}</td>
        <td>${r.tour_type}</td>
        <td>${r.group_size}</td>
        <td>${r.meals == null ? '' : r.meals ? 'Yes' : 'No'}</td>
        <td>${langs.join(', ') || '—'}</td>
        <td>${r.travel_date}</td>
        <td class="num">${r.price_usd != null ? '$' + r.price_usd.toFixed(2) : '—'}</td>
        <td class="num">${formatLocalPrice(r.price_local, r.currency) || '—'}</td>
        <td><a href="${escapeAttr(r.canonical_url)}" target="_blank">open</a></td>
        <td class="small">${r.sku_review_status}</td>
      </tr>`;
    })
    .join('');

  const css = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; margin: 0; padding: 32px; background: #fafafa; color: #111; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .card { background: white; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px 16px; }
    .card .label { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .card.warn .value { color: #b45309; }
    .card.ok .value { color: #15803d; }
    h2 { font-size: 15px; margin: 28px 0 10px; color: #333; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; font-size: 12px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-weight: 600; color: #444; border-bottom: 1px solid #e5e5e5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
    td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
    tr:last-child td { border-bottom: none; }
    .num { font-variant-numeric: tabular-nums; text-align: right; }
    .small { color: #888; font-size: 11px; }
    .img-cell { width: 120px; padding: 6px 8px; }
    .hero { width: 110px; height: 70px; object-fit: cover; border-radius: 6px; display: block; background: #f3f4f6; }
    .hero.placeholder { display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 10px; }
    .title-cell { max-width: 320px; }
    .badges { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
    .badge { background: #eef2ff; color: #4338ca; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 500; }
    .mono { font-family: ui-monospace, Menlo, monospace; }
    .screenshot-link { font-size: 10px; color: #2563eb; display: inline-block; margin-top: 4px; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .download { display: inline-block; background: #111; color: white; padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 13px; margin-right: 8px; }
    .download:hover { background: #333; text-decoration: none; }
    /* Cross-tab: footer row gets a top border + slight emphasis to read as totals. */
    .crosstab tfoot td { border-top: 1px solid #d1d5db; background: #fafafa; }
    .crosstab tbody tr:hover { background: #fafafa; }

    .filters { display: flex; gap: 14px; flex-wrap: wrap; margin: 12px 0 10px; }
    .filters label { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: #333; font-weight: 500; }
    .filters select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; background: white; min-width: 140px; }

    /* Tabs — sticky nav sits just below the download buttons. Inactive tabs
       fade to secondary colour; active tab gets the dark brand colour plus
       a subtle underline so it's readable against the off-white background. */
    .tab-nav { display: flex; gap: 6px; border-bottom: 1px solid #e5e5e5; margin: 18px 0 4px;
               position: sticky; top: 0; background: #fafafa; padding-top: 4px; z-index: 10; }
    .tab-nav button { background: transparent; border: none; padding: 10px 16px;
                      font-size: 13px; font-weight: 600; color: #666; cursor: pointer;
                      border-bottom: 2px solid transparent; margin-bottom: -1px;
                      font-family: inherit; transition: color 0.15s ease; }
    .tab-nav button:hover { color: #111; }
    .tab-nav button.active { color: #111; border-bottom-color: #111; }
    .tab-count { display: inline-block; background: #e5e5e5; color: #555; font-size: 10px;
                 padding: 1px 7px; border-radius: 999px; margin-left: 6px;
                 font-variant-numeric: tabular-nums; vertical-align: middle; font-weight: 500; }
    .tab-nav button.active .tab-count { background: #111; color: white; }

    .tab-panel { display: none; margin-top: 14px; }
    .tab-panel.active { display: block; }

    .footer { margin-top: 40px; color: #999; font-size: 11px; }
  `;

  const flags = summary.completeness_flags;
  const coverage =
    summary.sku_count > 0
      ? Math.round((summary.sku_with_usd / summary.sku_count) * 100)
      : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tours Report — ${summary.generated_at.slice(0, 10)}</title>
  <style>${css}</style>
</head>
<body>
  <h1>Tours Pricing Report</h1>
  <div class="sub">Generated at ${summary.generated_at}</div>

  <div>
    <a class="download" href="/csv" download="tours-latest.csv">Download CSV</a>
    <a class="download" style="background:#fff;color:#111;border:1px solid #d1d5db" href="../exports/latest.csv" download>Download (local)</a>
  </div>

  <nav class="tab-nav">
    <button data-tab="summary" class="active">Summary</button>
    <button data-tab="activities">Activities <span class="tab-count">${activities.length}</span></button>
    <button data-tab="data">Data <span class="tab-count">${rows.length}</span></button>
    <button data-tab="runs">Runs <span class="tab-count">${sessions.length + searchRuns.length}</span></button>
  </nav>

  <section class="tab-panel" data-panel="runs">
  ${sessions.length > 0 ? `
  <h2>Run sessions</h2>
  <table>
    <thead><tr>
      <th>Started</th><th>Destination</th><th>Keyword</th><th>POI</th>
      <th>Competitors</th><th>Limit</th><th>Status</th><th>Session ID</th>
    </tr></thead>
    <tbody>
      ${sessions.map((s) => `<tr>
        <td class="small mono">${escapeHtml((s.started_at || '').replace('T',' ').slice(0,19))}</td>
        <td>${escapeHtml(s.destination)}</td>
        <td>${escapeHtml(s.keyword || '—')}</td>
        <td>${escapeHtml(s.poi)}</td>
        <td class="small">${escapeHtml((() => { try { return JSON.parse(s.competitors).join(', '); } catch { return s.competitors; } })())}</td>
        <td class="num">${s.limit_per_platform}</td>
        <td><span class="badge" style="background:${s.status === 'done' ? '#dcfce7' : s.status === 'failed' ? '#fee2e2' : '#dbeafe'};color:${s.status === 'done' ? '#166534' : s.status === 'failed' ? '#991b1b' : '#1e40af'};">${escapeHtml(s.status)}</span></td>
        <td class="mono small">${escapeHtml(s.id)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  ${recentExecutions.length > 0 ? `
  <h2>Execution log (last 48h · ${recentExecutions.length} entries)</h2>
  <table>
    <thead><tr>
      <th>Started</th><th>Platform</th><th>Activity</th>
      <th>Strategy</th><th>Duration</th><th>OK?</th>
      <th>Pkgs</th><th>SKUs</th><th>Error</th>
    </tr></thead>
    <tbody>
      ${recentExecutions.map((e) => `<tr>
        <td class="small mono">${escapeHtml((e.started_at || '').replace('T',' ').slice(11,19))}</td>
        <td>${escapeHtml(PLATFORM_LABELS[e.platform] ?? e.platform)}</td>
        <td class="mono small">${escapeHtml(e.activity_id)}</td>
        <td class="small">${escapeHtml(e.strategy)}</td>
        <td class="num small">${(e.duration_ms / 1000).toFixed(1)}s</td>
        <td>${e.succeeded ? '✓' : '✗'}</td>
        <td class="num">${e.packages_written}</td>
        <td class="num">${e.skus_written}</td>
        <td class="small" style="color:#991b1b">${escapeHtml((e.error_message || '').slice(0, 80))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  ${searchRuns.length > 0 ? `
  <h2>Search runs (last 48h)</h2>
  <table>
    <thead><tr>
      <th>Platform</th><th>POI</th><th>Keyword</th>
      <th>Total found</th><th>Ingested</th><th>Succeeded</th><th>Failed</th><th>Run at</th>
    </tr></thead>
    <tbody>
      ${searchRuns.map((s) => `<tr>
        <td>${PLATFORM_LABELS[s.platform] ?? s.platform}</td>
        <td>${escapeHtml(s.poi)}</td>
        <td class="mono small">${escapeHtml(s.keyword)}</td>
        <td class="num">${s.total_found.toLocaleString()}</td>
        <td class="num">${s.ingested}</td>
        <td class="num">${s.succeeded}</td>
        <td class="num">${s.failed}</td>
        <td class="small">${s.run_at ?? ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}
  </section>

  <section class="tab-panel active" data-panel="summary">
  <h2>Coverage</h2>
  <div class="cards">
    <div class="card"><div class="label">Activities</div><div class="value">${summary.activity_count}</div></div>
    <div class="card"><div class="label">Packages</div><div class="value">${summary.package_count}</div></div>
    <div class="card"><div class="label">SKUs</div><div class="value">${summary.sku_count}</div></div>
    <div class="card ${coverage >= 90 ? 'ok' : coverage >= 60 ? '' : 'warn'}">
      <div class="label">USD coverage</div><div class="value">${coverage}%</div>
    </div>
    <div class="card"><div class="label">Verified SKUs</div><div class="value">${summary.review.skus_verified}</div></div>
    <div class="card ${summary.review.skus_flagged > 0 ? 'warn' : ''}">
      <div class="label">Flagged SKUs</div><div class="value">${summary.review.skus_flagged}</div>
    </div>
  </div>

  <h2>Per-platform</h2>
  <table>
    <thead><tr><th>Platform</th><th>Activities</th><th>SKUs</th></tr></thead>
    <tbody>${platformRows}</tbody>
  </table>

  <h2>Per-POI</h2>
  <table>
    <thead><tr><th>POI</th><th>Activities</th><th>SKUs</th></tr></thead>
    <tbody>${perPoiRows}</tbody>
  </table>

  <h2>POI × Platform <span class="small" style="font-weight:400;color:#888">(activities / SKUs)</span></h2>
  <table class="crosstab">
    <thead><tr>${crossHeader}</tr></thead>
    <tbody>${crossBody}</tbody>
    <tfoot>${crossFooter}</tfoot>
  </table>

  <h2>Completeness gaps</h2>
  <table>
    <thead><tr><th>Field</th><th>Missing / uncertain</th></tr></thead>
    <tbody>
      <tr><td>Supplier</td><td class="num">${flags.missing_supplier} activities</td></tr>
      <tr><td>Departure time</td><td class="num">${flags.missing_departure_time} packages</td></tr>
      <tr><td>Tour type (Join/Private)</td><td class="num">${flags.unknown_tour_type} packages</td></tr>
      <tr><td>Language</td><td class="num">${flags.no_language_detected} packages</td></tr>
      <tr><td>USD conversion</td><td class="num">${flags.no_usd_conversion} SKUs</td></tr>
    </tbody>
  </table>
  </section>

  <section class="tab-panel" data-panel="activities">
  <h2>Activities (<span id="act-count">${activities.length}</span>)</h2>
  <div class="filters">
    <label>POI
      <select data-filter-poi="activities">
        <option value="">All POIs</option>
        ${uniquePois.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
    </label>
    <label>OTA
      <select data-filter-platform="activities">
        <option value="">All OTAs</option>
        ${uniquePlatforms.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(PLATFORM_LABELS[p] ?? p)}</option>`).join('')}
      </select>
    </label>
  </div>
  <table id="activities-table">
    <thead><tr>
      <th style="width:120px">Hero</th>
      <th>Platform</th><th>POI</th><th>Title</th><th>Product&nbsp;ID</th>
      <th>Rating</th><th>Reviews</th><th>Orders</th>
      <th>Packages</th><th>SKUs</th><th>Price (USD)</th><th>Review</th>
    </tr></thead>
    <tbody>${activityRows}</tbody>
  </table>
  </section>

  <section class="tab-panel" data-panel="data">
  <h2>Data (<span id="data-count">first ${rows.length} rows</span>)</h2>
  <p class="sub">
    Currently each package shows <strong>1 SKU = 1 travel date</strong> because
    data is ingested via <code>detail</code> fallback (Klook's <code>pricing</code>
    scraper has a known calendar-nav bug). Once pricing is fixed, each package
    will fan out to N SKUs (one per day in the date window).
  </p>
  <div class="filters">
    <label>POI
      <select data-filter-poi="data">
        <option value="">All POIs</option>
        ${uniquePois.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
    </label>
    <label>OTA
      <select data-filter-platform="data">
        <option value="">All OTAs</option>
        ${uniquePlatforms.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(PLATFORM_LABELS[p] ?? p)}</option>`).join('')}
      </select>
    </label>
  </div>
  <table id="data-table">
    <thead><tr>
      <th>Product&nbsp;ID</th><th>Activity</th>
      <th>OTA</th><th>POI</th><th>Package</th><th>Type</th><th>Group</th><th>Meals</th>
      <th>Languages</th><th>Date</th><th>USD</th><th>Local</th><th>URL</th><th>Review</th>
    </tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </section>

  <div class="footer">Built with klook-cli tours pipeline · opencli primitives + canonical schema · ${summary.generated_at}</div>

<script>
// ── Tabs ──────────────────────────────────────────────────────────
// Simple show/hide: every tab button maps to a panel via data attributes.
// Remembers the selected tab in localStorage so a refresh keeps you where
// you were — handy when the BD keeps tweaking filters in the Data tab.
(function () {
  var KEY = 'tours-report-tab';
  function select(name) {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('[data-panel]').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-panel') === name);
    });
    try { localStorage.setItem(KEY, name); } catch (_e) {}
  }
  document.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () { select(btn.getAttribute('data-tab')); });
  });
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_e) {}
  if (saved && document.querySelector('[data-tab="' + saved + '"]')) select(saved);
})();

// ── Filters (POI / OTA) ──────────────────────────────────────────
// Client-side filters for Activities + Data tables. Each row has
// data-poi / data-platform attributes; the selects below the h2 headings
// narrow the visible set and update the count badge.
(function () {
  function apply(tableId, countId) {
    var table = document.getElementById(tableId);
    if (!table) return;
    var poiSel = document.querySelector('[data-filter-poi="' + (tableId === 'activities-table' ? 'activities' : 'data') + '"]');
    var platformSel = document.querySelector('[data-filter-platform="' + (tableId === 'activities-table' ? 'activities' : 'data') + '"]');
    var poi = poiSel ? poiSel.value : '';
    var plat = platformSel ? platformSel.value : '';
    var rows = table.querySelectorAll('tbody tr');
    var visible = 0;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var rp = tr.getAttribute('data-poi') || '';
      var rpl = tr.getAttribute('data-platform') || '';
      var show = (!poi || rp === poi) && (!plat || rpl === plat);
      tr.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    var counter = document.getElementById(countId);
    if (counter) {
      counter.textContent = tableId === 'activities-table'
        ? String(visible)
        : ('showing ' + visible + (poi || plat ? ' (filtered)' : ' rows'));
    }
  }

  document.querySelectorAll('[data-filter-poi], [data-filter-platform]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      apply('activities-table', 'act-count');
      apply('data-table', 'data-count');
    });
  });
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
