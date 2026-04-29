/**
 * Normalize raw opencli pricing output → canonical Activity / Package / SKU rows.
 *
 * The pricing commands already return SKU-level rows keyed by (package_id/sku_id × date).
 * Normalization only has to:
 *   - Stamp stable canonical IDs so repeated runs upsert cleanly.
 *   - Infer tour_type / group_size / meals from package name heuristics.
 *     These are Klook/Trip product conventions — good enough to seed, BD can override via review.
 *   - Preserve canonical_url and platform_product_id for daily re-scrape.
 */
import type {
  Activity,
  Package,
  SKU,
  SKUObservation,
  Platform,
  TourType,
  GroupSize,
  PricingRowRaw,
  PricingRunRaw,
} from './types.js';
import { KNOWN_FX } from './fx.js';

const BIG_GROUP_RE = /\b(large|big|group|shared|join)\b/i;
const SMALL_GROUP_RE = /\b(small\s*group|small-group|intimate|up\s*to\s*\d+)\b/i;
const PRIVATE_RE = /\b(private|charter|exclusive|chauffeur)\b/i;
const JOIN_RE = /\b(join|shared|group\s*tour)\b/i;
const MEAL_RE = /\b(lunch|breakfast|dinner|buffet|meal|bento|食事)\b/i;

function stableActivityId(platform: string, productId: string): string {
  return `${platform}:${productId}`;
}

function stablePackageId(
  platform: string,
  productId: string,
  rawKey: string,
): string {
  return `${platform}:${productId}:pkg:${rawKey}`;
}

function stableSKUId(packageId: string, travelDate: string): string {
  return `${packageId}:${travelDate}`;
}

function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function inferTourType(packageName: string): TourType {
  if (PRIVATE_RE.test(packageName)) return 'Private';
  if (JOIN_RE.test(packageName)) return 'Join';
  return 'Unknown';
}

/**
 * When a package name is ambiguous, fall back to the activity-level context.
 * OTAs overwhelmingly sell Join (shared group) tours, so that is the pragmatic
 * default — but we still flag completeness as uncertain so BD can override.
 */
export function resolveTourType(
  packageName: string,
  activityTitle: string,
): { value: TourType; uncertain: boolean } {
  const pkg = inferTourType(packageName);
  if (pkg !== 'Unknown') return { value: pkg, uncertain: false };
  const act = inferTourType(activityTitle);
  if (act !== 'Unknown') return { value: act, uncertain: false };
  return { value: 'Join', uncertain: true };
}

export function inferGroupSize(
  packageName: string,
  tourType: TourType,
): GroupSize {
  if (tourType === 'Private') return '-';
  if (SMALL_GROUP_RE.test(packageName)) return 'small';
  if (BIG_GROUP_RE.test(packageName)) return 'big';
  return 'big';
}

export function inferMeals(packageName: string): boolean | null {
  if (MEAL_RE.test(packageName)) return true;
  return null;
}

export function inferLanguages(packageName: string): string[] {
  const langs: string[] = [];
  const lower = packageName.toLowerCase();
  const matches: [RegExp, string][] = [
    [/english|英文|英語/i, 'English'],
    [/chinese|中文|mandarin|廣東|cantonese/i, 'Chinese'],
    [/japanese|日文|日語|にほんご/i, 'Japanese'],
    [/korean|韓文|한국어/i, 'Korean'],
    [/thai|泰文/i, 'Thai'],
  ];
  for (const [re, name] of matches) {
    if (re.test(lower) && !langs.includes(name)) langs.push(name);
  }
  return langs;
}

export function toUSD(
  priceLocal: number | null,
  currency: string | null,
): number | null {
  if (priceLocal == null || !currency) return null;
  const code = currency.toUpperCase().replace('$', '').trim();
  if (code === 'USD' || code === 'US') return priceLocal;
  const rate = KNOWN_FX[code as keyof typeof KNOWN_FX];
  if (!rate) return null;
  return +(priceLocal * rate).toFixed(2);
}

export interface NormalizedRun {
  activity: Activity;
  packages: Map<string, Package>;
  skus: SKU[];
  observations: SKUObservation[];
  warnings: string[];
}

export interface NormalizeOptions {
  platform: Platform;
  poi: string | null;
  canonicalUrl?: string;
  now?: string;
  /** Raw detail output used to populate Activity-level fields (rating, reviews, extras). */
  detailRaw?: Record<string, unknown>;
}

/**
 * Parse count-like strings: "339 reviews" → 339, "1,234" → 1234,
 * "3.2K reviews" → 3200, "1.5M" → 1_500_000, "4.8" → 4.8.
 * The K/M multiplier only applies when a suffix is present, otherwise decimals
 * are preserved (ratings like 4.8 stay 4.8).
 */
function parseNumberish(input: unknown): number | null {
  if (input == null) return null;
  const s = String(input).replace(/,/g, '').trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') return Math.round(base * 1_000);
  if (suffix === 'm') return Math.round(base * 1_000_000);
  return base;
}

/** Parse "100K+ booked" / "1.2M booked" / "3,456 sold" → integer. */
function parseBookCount(input: unknown): number | null {
  if (input == null) return null;
  const s = String(input).toLowerCase();
  const m = s.match(/([\d.]+)\s*([km])?/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  const mul = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1;
  return Math.round(base * mul);
}

/**
 * Well-known fields we've already canonicalized — everything else from the
 * detail output lands in raw_extras so no info is lost.
 */
const CANONICAL_FIELDS = new Set([
  'title', 'description', 'rating', 'review_count', 'order_count',
  'url', 'city', 'category', 'starScore', 'reviewCount', 'bookCount',
  'images', 'itinerary', 'packages', 'sections',
  'supplier', 'languages_header', 'tour_type_tag', 'meeting_tag', 'badges',
  'languagesHeader', 'tourTypeTag', 'meetingTag',
  'cancellation_policy',
  // option_dimensions is captured at the package level, not in activity extras
  'option_dimensions',
]);

function pickExtras(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (CANONICAL_FIELDS.has(k)) continue;
    if (v == null) continue;
    out[k] = v;
  }
  // Also stash a compact preview of images/sections so the notes column is useful
  if (Array.isArray((detail as any).images) && (detail as any).images.length) {
    out.image_count = (detail as any).images.length;
    out.first_image = (detail as any).images[0];
  }
  if (Array.isArray((detail as any).sections)) {
    const rawSections = (detail as any).sections;
    out.section_titles = rawSections
      .map((s: any) => s.original_title || s.title)
      .filter(Boolean);
    // Full sections with body content. Capped at 2KB per section to keep
    // raw_extras_json reasonable; the dashboard uses these for the
    // "What you'll do", "Things to know", "Cancellation policy" detail
    // blocks under each activity.
    out.sections = rawSections
      .map((s: any) => ({
        title: s.title || s.original_title || '',
        content: typeof s.content === 'string' ? s.content.slice(0, 2000) : '',
      }))
      .filter((s: any) => s.title && s.content);
  }
  // Store the full option_dimensions list so BD can see every variant axis
  // a platform exposed, even when we haven't yet fanned them into separate
  // package rows.
  if (Array.isArray((detail as any).option_dimensions) && (detail as any).option_dimensions.length) {
    out.option_dimensions = (detail as any).option_dimensions;
  }
  return out;
}

export function normalizePricingRun(
  raw: PricingRunRaw,
  opts: NormalizeOptions,
): NormalizedRun {
  const now = opts.now ?? new Date().toISOString();
  const productId = raw.activity_id;
  const activityId = stableActivityId(opts.platform, productId);
  const canonicalUrl = opts.canonicalUrl ?? raw.url;

  const detail = opts.detailRaw ?? {};
  const rating = parseNumberish((detail as any).rating ?? (detail as any).starScore);
  const reviewCount = parseNumberish((detail as any).review_count ?? (detail as any).reviewCount);
  const orderCount = parseBookCount(
    (detail as any).order_count ?? (detail as any).bookCount ?? (detail as any).bookings,
  );
  const description =
    typeof (detail as any).description === 'string' ? (detail as any).description : null;
  const detailSupplier =
    typeof (detail as any).supplier === 'string' && (detail as any).supplier.length > 0
      ? (detail as any).supplier
      : null;
  const cancellationPolicy =
    typeof (detail as any).cancellation_policy === 'string' && (detail as any).cancellation_policy.length > 0
      ? (detail as any).cancellation_policy
      : null;
  const activityLangHeader =
    typeof (detail as any).languages_header === 'string'
      ? (detail as any).languages_header
      : typeof (detail as any).languagesHeader === 'string'
      ? (detail as any).languagesHeader
      : '';
  const activityTourTag =
    (detail as any).tour_type_tag || (detail as any).tourTypeTag || '';
  const activityMeetingTag =
    (detail as any).meeting_tag || (detail as any).meetingTag || '';

  const activity: Activity = {
    id: activityId,
    platform: opts.platform,
    platform_product_id: productId,
    canonical_url: canonicalUrl,
    title: raw.title || raw.rows[0]?.activity_title || '(unknown)',
    supplier: detailSupplier,
    poi: opts.poi,
    duration_minutes: null,
    departure_city: null,
    rating,
    review_count: reviewCount,
    order_count: orderCount,
    description,
    cancellation_policy: cancellationPolicy,
    raw_extras_json: JSON.stringify(pickExtras(detail)),
    first_scraped_at: now,
    last_scraped_at: now,
    review_status: 'unverified',
    review_note: null,
  };

  const packages = new Map<string, Package>();
  const skus: SKU[] = [];
  const observations: SKUObservation[] = [];
  const warnings: string[] = [];

  for (const row of raw.rows ?? []) {
    const rawPkgKey =
      row.package_id || row.sku_id || `${row.package_name || 'pkg'}`;
    const pkgId = stablePackageId(opts.platform, productId, rawPkgKey);
    const pkgTitleSource = [row.group_title, row.package_name]
      .filter(Boolean)
      .join(' — ');

    if (!packages.has(pkgId)) {
      const activityTitle = raw.title || row.activity_title || '';

      // Package-level tour type: prefer package name, fall back to activity
      // header tag, then activity title, else Join.
      let resolved = resolveTourType(pkgTitleSource, activityTitle);
      if (resolved.uncertain && activityTourTag) {
        const fromTag = inferTourType(activityTourTag);
        if (fromTag !== 'Unknown') resolved = { value: fromTag, uncertain: false };
      }

      // Languages: the activity header usually lists ALL languages for the
      // activity — if the package name doesn't mention a specific one, the
      // package supports the full set.
      const pkgLangs = inferLanguages(pkgTitleSource);
      const headerLangs = activityLangHeader
        ? activityLangHeader
            .split(/[\/,、]/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && s.length < 30)
        : [];
      const languages = pkgLangs.length > 0 ? pkgLangs : headerLangs;

      // Departure time: use the first timed step of the activity's itinerary
      // as a package-level default. Good enough seed — BD can override.
      const itinerary = Array.isArray((detail as any).itinerary)
        ? ((detail as any).itinerary as { time?: string }[])
        : [];
      const firstTimed = itinerary.find((s) => s.time && /\d{1,2}:\d{2}/.test(s.time));
      const departureTime = firstTimed?.time ?? null;

      // Departure city: derive from activity-level meeting tag or title hints
      const titleLower = activityTitle.toLowerCase();
      const cityHints = ['tokyo', 'shinjuku', 'osaka', 'kyoto', 'seoul', 'busan', 'taipei'];
      const cityHit = cityHints.find((c) => titleLower.includes(c));
      const departureCity = cityHit
        ? cityHit.charAt(0).toUpperCase() + cityHit.slice(1)
        : null;

      packages.set(pkgId, {
        id: pkgId,
        activity_id: activityId,
        platform_package_id: rawPkgKey,
        title: pkgTitleSource || row.package_name || '(unnamed)',
        tour_type: resolved.value,
        available_languages: languages,
        group_size: inferGroupSize(pkgTitleSource, resolved.value),
        meals: inferMeals(pkgTitleSource),
        departure_city: departureCity,
        departure_time: departureTime,
        duration_minutes: null,
        inclusions: [],
        exclusions: [],
        completeness_json: JSON.stringify({
          tour_type: resolved.uncertain ? 'uncertain' : 'ok',
          languages: languages.length > 0 ? 'ok' : 'missing',
          meals: 'uncertain',
          departure_time: departureTime ? 'ok' : 'missing',
          supplier: detailSupplier ? 'ok' : 'missing',
          meeting_type: activityMeetingTag ? 'ok' : 'missing',
          option_dimensions: Array.isArray((detail as any).option_dimensions)
            ? ((detail as any).option_dimensions as unknown[]).length > 0
              ? 'ok'
              : 'missing'
            : 'missing',
        }),
      });
    }

    const priceLocal = parsePrice(row.price);
    const currency = row.currency?.toUpperCase().replace('$', '').trim() || null;
    const priceUsd = toUSD(priceLocal, currency);
    const available = !/sold\s*out|unavailable/i.test(row.availability || '');

    const skuId = stableSKUId(pkgId, row.date);
    skus.push({
      id: skuId,
      package_id: pkgId,
      travel_date: row.date,
      price_local: priceLocal,
      price_usd: priceUsd,
      currency,
      available,
      last_checked_at: row.check_date_time_gmt8 || now,
    });

    observations.push({
      sku_id: skuId,
      checked_at: row.check_date_time_gmt8 || now,
      price_local: priceLocal,
      price_usd: priceUsd,
      available,
    });
  }

  if (raw.errors && raw.errors.length > 0) {
    warnings.push(
      `Upstream scraper reported ${raw.errors.length} error(s): ${raw.errors
        .slice(0, 3)
        .map((e) => e.reason)
        .join('; ')}`,
    );
  }

  return { activity, packages, skus, observations, warnings };
}
