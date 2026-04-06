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
  url: string;
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
