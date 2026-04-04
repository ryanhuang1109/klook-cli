/**
 * trip/search — Search Trip.com activities via Browser Bridge.
 *
 * Trip.com (Ctrip international) renders activity listings server-side
 * with no public search API. Uses COOKIE strategy to extract from DOM.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { clampLimit } from '../klook/search.js';
import { parseSearchResults } from '../../shared/parsers.js';

export function buildSearchEvaluate(limit: number): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      const links = document.querySelectorAll('a[href*="/things-to-do/detail/"]');
      const seen = new Set();
      const items = [];
      for (const a of links) {
        const href = str(a.getAttribute('href'));
        if (seen.has(href)) continue;
        seen.add(href);
        const card = a.closest('[class*="card_layout"]') || a.parentElement?.parentElement || a;
        const text = str(card.textContent);
        const titleEl = card.querySelector('[class*="title"], h3, h4');
        const title = str(titleEl?.textContent || a.textContent).slice(0, 200);
        const ratingMatch = text.match(/([\\d.]+)\\/5/);
        const reviewMatch = text.match(/(\\d[\\d,]*)\\s*reviews?/i);
        const priceMatch = text.match(/(?:From\\s*)?([A-Z]{2,3}\\$?\\s*[\\d,.]+)/);
        items.push({
          title,
          price: priceMatch ? priceMatch[1] : '',
          currency: '',
          starScore: ratingMatch ? ratingMatch[1] : '',
          reviewCount: reviewMatch ? reviewMatch[1] + ' reviews' : '',
          categoryName: '',
          cityName: '',
          deeplink: href.startsWith('http') ? href : 'https://www.trip.com' + href,
        });
        if (items.length >= ${limit}) break;
      }
      return { items };
    })()
  `;
}

cli({
  site: 'trip',
  name: 'search',
  description: 'Search Trip.com activities, tickets, and experiences',
  domain: 'www.trip.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Tokyo", "Mt Fuji tour")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
  ],
  columns: ['rank', 'title', 'price', 'rating', 'review_count', 'url'],
  func: async (page: IPage, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    const url = `https://www.trip.com/things-to-do/list?keyword=${encodeURIComponent(query)}&locale=en-XX`;

    await page.goto(url);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error('No results found on Trip.com. Try different keywords.');
    }
    return results;
  },
});
