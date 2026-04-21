/**
 * Parse the user's pricing-tna-planning CSV into structured rows and
 * extract the set of (platform, activity_id) pairs we must cover.
 *
 * The CSV was exported from Google Sheets and has a slightly weird header
 * (multiline "Departure time" cell, two empty columns around notes). We
 * tolerate the quirks rather than reshape the sheet.
 */
import * as fs from 'node:fs';

export interface GoldenRow {
  ota: string;
  main_poi: string;
  language: string;
  tour_type: string;
  group_size: string;
  meals: string;
  departure_city: string;
  departure_time: string;
  check_datetime_gmt8: string;
  lowest_price_url: string;
  price_usd: number | null;
  price_local: string;
}

/** Minimal CSV splitter that understands quoted fields with commas / newlines. */
function splitCSVRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuote) {
      if (c === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else if (c === '"') {
      inQuote = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseRowsWithMultilineQuotes(raw: string): string[][] {
  const rows: string[][] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') inQuote = !inQuote;
    if (c === '\n' && !inQuote) {
      rows.push(splitCSVRow(buf.replace(/\r$/, '')));
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) rows.push(splitCSVRow(buf));
  return rows;
}

export function loadGoldenCSV(csvPath: string): GoldenRow[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseRowsWithMultilineQuotes(raw);
  if (rows.length < 2) return [];

  const out: GoldenRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || !r[0].trim()) continue;

    const priceUsdStr = (r[11] ?? '').trim();
    const priceUsd = priceUsdStr ? parseFloat(priceUsdStr) : null;

    out.push({
      ota: (r[0] || '').trim(),
      main_poi: (r[1] || '').trim(),
      language: (r[2] || '').trim(),
      tour_type: (r[3] || '').trim(),
      group_size: (r[4] || '').trim(),
      meals: (r[5] || '').trim(),
      departure_city: (r[6] || '').trim(),
      departure_time: (r[7] || '').trim(),
      check_datetime_gmt8: (r[8] || '').trim(),
      lowest_price_url: (r[10] || '').trim(),
      price_usd: Number.isFinite(priceUsd as number) ? (priceUsd as number) : null,
      price_local: (r[12] || '').trim(),
    });
  }
  return out;
}

export interface ActivityTarget {
  platform: string;
  activity_id: string;
  url: string;
  poi: string;
}

const URL_ID_PATTERNS: { platform: string; regex: RegExp }[] = [
  { platform: 'klook', regex: /klook\.com\/[^/]+\/activity\/(\d+)/i },
  { platform: 'klook', regex: /klook\.com\/activity\/(\d+)/i },
  { platform: 'trip', regex: /trip\.com\/[^/]*\/?detail\/(\d+)/i },
  { platform: 'kkday', regex: /kkday\.com\/[^/]+\/product\/(\d+)/i },
  { platform: 'getyourguide', regex: /getyourguide\.com\/.+-t(\d+)/i },
];

export function extractActivityTarget(url: string, poi: string): ActivityTarget | null {
  for (const { platform, regex } of URL_ID_PATTERNS) {
    const m = url.match(regex);
    if (m) return { platform, activity_id: m[1], url, poi };
  }
  return null;
}

export function uniqueActivityTargets(rows: GoldenRow[]): ActivityTarget[] {
  const seen = new Set<string>();
  const out: ActivityTarget[] = [];
  for (const r of rows) {
    if (!r.lowest_price_url) continue;
    const target = extractActivityTarget(r.lowest_price_url, r.main_poi);
    if (!target) continue;
    const key = `${target.platform}:${target.activity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}
