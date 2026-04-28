import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Platform } from './data';

export type PlanningRow = {
  ota: string;
  product_id: string;
  activity_title: string;
  main_poi: string;
  language: string;
  tour_type: string;
  group_size: string;
  meals: string;
  departure_city: string;
  departure_time: string;
  travel_date: string;
  check_date_time: string;
  lowest_price_aid: string;
  price_usd: string;
  price_destination_local: string;
  supplier: string;
  package: string;
  rating: string;
  review_count: string;
  order_count: string;
  notes: string;
  sku_review: string;
};

const HEADER_KEY: Record<string, keyof PlanningRow> = {
  'OTA': 'ota',
  'Product ID': 'product_id',
  'Activity Title': 'activity_title',
  'Main POI': 'main_poi',
  'Language': 'language',
  'Tour Type': 'tour_type',
  'Group size': 'group_size',
  'Meals': 'meals',
  'Departure City': 'departure_city',
  'Departure time': 'departure_time',
  'Travel Date': 'travel_date',
  'Check Date_Time (GMT+8)': 'check_date_time',
  'Lowest_Price_AID': 'lowest_price_aid',
  'Price_USD': 'price_usd',
  'Price_Destination_Local': 'price_destination_local',
  'Supplier': 'supplier',
  'Package': 'package',
  'Rating': 'rating',
  'Review Count': 'review_count',
  'Order Count': 'order_count',
  'Notes (platform extras)': 'notes',
  'SKU Review': 'sku_review',
};

/**
 * OTA column in the CSV uses display names like "GetYourGuide" / "Trip.com".
 * Map them to the Platform enum used elsewhere in the dashboard so the
 * platform filter pills can drive the same row set.
 */
export function otaToPlatform(ota: string): Platform | null {
  const v = ota.trim().toLowerCase();
  if (v === 'klook') return 'klook';
  if (v === 'trip.com' || v === 'trip') return 'trip';
  if (v === 'getyourguide' || v === 'gyg') return 'getyourguide';
  if (v === 'kkday') return 'kkday';
  if (v === 'airbnb') return 'airbnb';
  return null;
}

/**
 * Reads the planning CSV from web/public/exports/latest.csv (copied there by
 * the prebuild script). Returns an empty list when the file isn't present —
 * which happens before the daily routine has run for the first time.
 */
export function readPlanningRows(): PlanningRow[] {
  const p = path.join(process.cwd(), 'public', 'exports', 'latest.csv');
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch {
    return [];
  }
  const records = parse(raw, {
    columns: (header: string[]) => header.map((h) => HEADER_KEY[h] ?? h.toLowerCase()),
    skip_empty_lines: true,
    relax_quotes: true,
    trim: false,
  }) as Array<Record<string, string>>;
  return records as PlanningRow[];
}
