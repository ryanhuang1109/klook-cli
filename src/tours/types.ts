/**
 * Canonical three-tier schema: Activity → Package → SKU.
 *
 * Activity = top-level listing (1 per URL / product_id).
 * Package  = buyable variant (language, group size, meal options, departure time).
 * SKU      = (package × travel_date) — the thing with a price on a given day.
 *
 * A single CSV row in the user's sheet projects one SKU joined with its
 * parent Package + Activity, fanned out by `available_languages` (language is
 * a package option on most OTAs, not an SKU-level attribute).
 */
import { z } from 'zod';

export const PlatformEnum = z.enum(['klook', 'trip', 'kkday', 'getyourguide', 'airbnb']);
export type Platform = z.infer<typeof PlatformEnum>;

export const TourTypeEnum = z.enum(['Join', 'Private', 'Unknown']);
export type TourType = z.infer<typeof TourTypeEnum>;

export const GroupSizeEnum = z.enum(['big', 'small', '-']);
export type GroupSize = z.infer<typeof GroupSizeEnum>;

export const ReviewStatusEnum = z.enum([
  'unverified',
  'verified',
  'flagged',
  'rejected',
]);
export type ReviewStatus = z.infer<typeof ReviewStatusEnum>;

export const CompletenessEnum = z.enum(['ok', 'missing', 'uncertain']);
export type Completeness = z.infer<typeof CompletenessEnum>;

export const ActivitySchema = z.object({
  id: z.string(),
  platform: PlatformEnum,
  platform_product_id: z.string(),
  canonical_url: z.string().url(),
  title: z.string(),
  supplier: z.string().nullable(),
  poi: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  departure_city: z.string().nullable(),
  rating: z.number().nullable(),
  review_count: z.number().nullable(),
  order_count: z.number().nullable(),
  description: z.string().nullable(),
  cancellation_policy: z.string().nullable(),
  /** Per-platform catch-all: extra fields we scraped but haven't canonicalized yet. */
  raw_extras_json: z.string().default('{}'),
  first_scraped_at: z.string(),
  last_scraped_at: z.string(),
  review_status: ReviewStatusEnum.default('unverified'),
  review_note: z.string().nullable().default(null),
  /** 1 = pinned (always ingest pricing); 0 = catalog-only. Set via setPinned, never overwritten by upsert. */
  is_pinned: z.number().int().default(0),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const PackageSchema = z.object({
  id: z.string(),
  activity_id: z.string(),
  platform_package_id: z.string().nullable(),
  title: z.string(),
  tour_type: TourTypeEnum,
  available_languages: z.array(z.string()),
  group_size: GroupSizeEnum,
  meals: z.boolean().nullable(),
  departure_city: z.string().nullable(),
  departure_time: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  inclusions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  completeness_json: z.string().default('{}'),
});
export type Package = z.infer<typeof PackageSchema>;

export const SKUSchema = z.object({
  id: z.string(),
  package_id: z.string(),
  travel_date: z.string(),
  price_local: z.number().nullable(),
  price_usd: z.number().nullable(),
  currency: z.string().nullable(),
  available: z.boolean(),
  last_checked_at: z.string(),
});
export type SKU = z.infer<typeof SKUSchema>;

export const SKUObservationSchema = z.object({
  sku_id: z.string(),
  checked_at: z.string(),
  price_local: z.number().nullable(),
  price_usd: z.number().nullable(),
  available: z.boolean(),
});
export type SKUObservation = z.infer<typeof SKUObservationSchema>;

/**
 * Row in the user's planning CSV — one per (activity × package options ×
 * language × departure_time × check_datetime).
 */
export const SheetRowSchema = z.object({
  ota: z.string(),
  main_poi: z.string(),
  language: z.string(),
  tour_type: z.string(),
  group_size: z.string(),
  meals: z.string(),
  departure_city: z.string(),
  departure_time: z.string(),
  check_datetime_gmt8: z.string(),
  lowest_price_url: z.string(),
  price_usd: z.number().nullable(),
  price_local: z.string(),
});
export type SheetRow = z.infer<typeof SheetRowSchema>;

/** Raw pricing output from `opencli <site> pricing`. */
export interface PricingRunRaw {
  activity_id: string;
  ota: string;
  url: string;
  title: string;
  days_requested: number;
  days_captured: number;
  rows: PricingRowRaw[];
  errors?: { date?: string; sku_id?: string; reason: string }[];
  _warning?: string;
}

export interface PricingRowRaw {
  ota: string;
  activity_id: string;
  activity_title: string;
  activity_url: string;
  date: string;
  check_date_time_gmt8: string;
  package_id?: string;
  sku_id?: string;
  group_title?: string;
  package_name: string;
  price: string;
  currency: string;
  original_price?: string;
  availability: string;
  price_raw?: string;
}
