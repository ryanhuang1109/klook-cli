/** A search result or trending activity item. */
export interface KlookActivity {
  rank: number;
  title: string;
  price: string;
  currency: string;
  rating: string;
  review_count: string;
  category: string;
  city: string;
  url: string;
}

/** A single step in an activity itinerary. */
export interface KlookItineraryStep {
  time: string;
  title: string;
  description: string;
}

/** A bookable package/option within an activity. */
export interface KlookPackage {
  name: string;
  description: string;
  inclusions: string[];
  exclusions: string[];
  price: string;
  currency: string;
  original_price: string;
  discount: string;
  date: string;
  availability: string;
}

/** A named section on the activity detail page (e.g. "What to expect"). */
export interface ActivitySection {
  /** Standardised title using Klook naming convention. */
  title: string;
  /** The platform's original section title (e.g. GYG "Includes" → Klook "What's included"). */
  original_title: string;
  content: string;
}

/** Full activity detail including itinerary and packages. */
export interface KlookDetail {
  title: string;
  description: string;
  city: string;
  category: string;
  rating: string;
  review_count: string;
  images: string[];
  itinerary: KlookItineraryStep[];
  packages: KlookPackage[];
  sections: ActivitySection[];
  url: string;
  /** "200K+ booked" etc. — kept as raw string; normalizer parses to int. */
  order_count?: string;
  /** Klook-style badges like "Klook's choice", "Cherry Blossom Guarantee". */
  badges?: string[];
  /** Header languages like "English/Chinese/Hindi/Japanese/Korean". */
  languages_header?: string;
  /** Tour type tag shown in header ("Join in group", "Private tour"). */
  tour_type_tag?: string;
  /** Meeting-type tag ("Meet at location", "Hotel pickup"). */
  meeting_tag?: string;
  /** Supplier / operator name if parseable from page text. */
  supplier?: string;
  /**
   * Package-variant axes scraped from booking-widget dropdowns/tabs.
   * Each dimension is one choice the user has to make: language, passenger
   * tier, vehicle, guide type etc. The full set of packages = cartesian
   * product of these dimensions, though we don't always fan out that way.
   */
  option_dimensions?: { label: string; selected: string; options: string[] }[];
  /** Cancellation/refund policy text — projected from the standardized "Cancellation policy" section. */
  cancellation_policy?: string;
  /** Absolute path to a PNG screenshot written during get-activity (when --screenshot is on). */
  screenshot_path?: string;
  /** Inline base64-encoded PNG (when --screenshot base64). Large — opt-in only. */
  screenshot_base64?: string;
}

/** A POI (Point of Interest) to monitor across platforms. */
export interface POI {
  name: string;
  keywords: string[];
  platforms: string[];
  date_range?: string;
}

/** A single product in a comparison group. */
export interface CompareProduct {
  platform: string;
  title: string;
  price_usd: number | null;
  price_original: string;
  rating: string;
  review_count: string;
  url: string;
  notes: string;
}

/** A group of similar/equivalent products across platforms. */
export interface CompareGroup {
  group_name: string;
  description: string;
  products: CompareProduct[];
  cheapest: string;
  best_rated: string;
}

/** Full comparison result from LLM clustering. */
export interface CompareResult {
  query: string;
  date: string;
  groups: CompareGroup[];
  currency_rates_used: string;
}
