/**
 * klook/search — Search Klook activities via public API.
 *
 * Uses Klook's public search API directly (no browser needed).
 * API: /v1/cardinfocenterservicesrv/search/platform/empty_query_search
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseSearchResults } from '../../shared/parsers.js';

export function clampLimit(raw: unknown, fallback = 20): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 50));
}

/** Map Klook API sort values to our CLI sort options */
function mapSort(sort: string | undefined): string {
  switch (sort) {
    case 'price': return 'price';
    case 'rating': return 'review_score';
    case 'popular': return 'participants';
    default: return 'most_relevant';
  }
}

/** Transform a Klook API card into the shape our parsers expect */
function mapCard(card: any): Record<string, string> {
  const data = card?.data;
  if (!data) return {};
  return {
    title: data.title ?? '',
    price: data.price?.selling_price ?? '',
    currency: '', // currency is embedded in selling_price string (e.g. "HK$ 450")
    starScore: data.review_obj?.star ?? '',
    reviewCount: data.review_obj?.count ?? '',
    categoryName: data.category ?? '',
    cityName: data.city_name ?? '',
    deeplink: data.deep_link ?? '',
  };
}

cli({
  site: 'klook',
  name: 'search-activities',
  aliases: ['search'],
  description: 'Search Klook activities, tickets, and experiences',
  domain: 'www.klook.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Tokyo Disneyland")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
    { name: 'sort', choices: ['price', 'rating', 'popular'], help: 'Sort order' },
    { name: 'lang', default: 'en_BS', help: 'Language code (e.g. en_BS, zh_TW, ja)' },
    { name: 'currency', default: 'USD', help: 'Currency code (e.g. USD, TWD, HKD, JPY)' },
  ],
  columns: ['rank', 'title', 'price', 'rating', 'review_count', 'category', 'city', 'url'],
  func: async (_page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    const sort = mapSort(kwargs.sort as string);
    const lang = String(kwargs.lang || 'en_BS');
    const currency = String(kwargs.currency || 'USD');

    const apiUrl = `https://www.klook.com/v1/cardinfocenterservicesrv/search/platform/empty_query_search?` +
      `page_size=${limit}&sort=${sort}&page_num=1&query=${encodeURIComponent(query)}` +
      `&search_landing=true&k_lang=${encodeURIComponent(lang)}&k_currency=${encodeURIComponent(currency)}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Klook API returned ${response.status}`);
    }

    const payload = await response.json();
    const cards = payload?.result?.search_result?.cards ?? [];
    const items = cards.map(mapCard);
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error('No results found. Try different keywords.');
    }
    return results;
  },
});

export const __test__ = { clampLimit, mapCard, mapSort };
