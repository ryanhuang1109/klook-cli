/**
 * kkday/search — Search KKday activities via Browser Bridge.
 *
 * KKday search list shows basic info (title + location).
 * Product links follow pattern: /en/product/{id}
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { clampLimit } from '../klook/search.js';
import { parseSearchResults } from '../../shared/parsers.js';

export function buildSearchEvaluate(limit: number): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      const links = document.querySelectorAll('a[href*="/product/"]');
      const seen = new Set();
      const items = [];
      for (const a of links) {
        const href = str(a.getAttribute('href'));
        const idMatch = href.match(/\\/product\\/(\\d+)/);
        if (!idMatch || seen.has(idMatch[1])) continue;
        seen.add(idMatch[1]);
        const card = a.closest('.search-result-item, [class*="product-card"], article, li') || a;
        const text = str(card.textContent);
        const titleEl = card.querySelector('[class*="title"], h2, h3');
        const title = str(titleEl?.textContent || a.textContent).slice(0, 200);
        // Price: "US$ 55.80" or "TWD 1,200"
        const priceMatch = text.match(/((?:US|TWD|HK|EUR|JPY|KRW|SGD)\\$?\\s*[\\d,.]+)/);
        // Rating
        const ratingMatch = text.match(/(\\d\\.\\d)\\s*(?:\\(|★)/);
        const reviewMatch = text.match(/(\\d[\\d,]*[KkMm]?)\\+?\\s*(?:reviews?|ratings?)/i);
        // City/location
        const locEl = card.querySelector('[class*="location"], [class*="city"]');
        const city = str(locEl?.textContent);
        items.push({
          title,
          price: priceMatch ? priceMatch[1] : '',
          currency: '',
          starScore: ratingMatch ? ratingMatch[1] : '',
          reviewCount: reviewMatch ? reviewMatch[1] + ' reviews' : '',
          categoryName: '',
          cityName: city,
          deeplink: href.startsWith('http') ? href : 'https://www.kkday.com' + href,
        });
        if (items.length >= ${limit}) break;
      }
      return { items };
    })()
  `;
}

cli({
  site: 'kkday',
  name: 'search',
  description: 'Search KKday activities, tickets, and tours',
  domain: 'www.kkday.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Universal Studios Japan")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
  ],
  columns: ['rank', 'title', 'price', 'rating', 'review_count', 'city', 'url'],
  func: async (page: IPage, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    const url = `https://www.kkday.com/en/product/productlist?keyword=${encodeURIComponent(query)}`;

    await page.goto(url);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error('No results found on KKday. Try different keywords.');
    }
    return results;
  },
});
