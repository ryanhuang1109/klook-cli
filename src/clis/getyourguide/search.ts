/**
 * getyourguide/search — Search GetYourGuide activities via Browser Bridge.
 *
 * GetYourGuide renders search results via SSR (no public API found).
 * Activity links follow pattern: /city-l{id}/title-t{activityId}/
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { clampLimit } from '../klook/search.js';
import { parseSearchResults } from '../../shared/parsers.js';

export function buildSearchEvaluate(limit: number): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      const links = document.querySelectorAll('a[href*="/activity/"], a[href*="-t"]');
      const seen = new Set();
      const items = [];
      for (const a of links) {
        const href = str(a.getAttribute('href'));
        // Match GYG activity URL pattern: /city-lXXX/title-tXXX/
        if (!/-t\\d+/.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const card = a.closest('[data-activity-card], article, [class*="card"]') || a;
        const text = str(card.textContent);
        const titleEl = card.querySelector('h2, h3, [class*="title"]');
        const title = str(titleEl?.textContent || a.textContent).replace(/Top pick|Booked \\d+.*/g, '').trim().slice(0, 200);
        // Rating: "4.3(1,032)" pattern
        const ratingMatch = text.match(/(\\d\\.\\d)\\s*\\(/);
        const reviewMatch = text.match(/\\(([\\ \\d,]+)\\)/);
        // Price: "From US$ 55" or "€ 49"
        const priceMatch = text.match(/(?:From\\s+)?((?:US\\s*\\$|€|£|A\\$|C\\$|S\\$)\\s*[\\d,.]+)/);
        items.push({
          title,
          price: priceMatch ? priceMatch[1] : '',
          currency: '',
          starScore: ratingMatch ? ratingMatch[1] : '',
          reviewCount: reviewMatch ? reviewMatch[1].trim() + ' reviews' : '',
          categoryName: '',
          cityName: '',
          deeplink: href.startsWith('http') ? href : 'https://www.getyourguide.com' + href,
        });
        if (items.length >= ${limit}) break;
      }
      return { items };
    })()
  `;
}

cli({
  site: 'getyourguide',
  name: 'search-activities',
  aliases: ['search'],
  description: 'Search GetYourGuide activities, tickets, and tours',
  domain: 'www.getyourguide.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Universal Studios Japan")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
  ],
  columns: ['rank', 'title', 'price', 'rating', 'review_count', 'url'],
  func: async (page: IPage, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    const url = `https://www.getyourguide.com/s/?q=${encodeURIComponent(query)}`;

    await page.goto(url);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error('No results found on GetYourGuide. Try different keywords.');
    }
    return results;
  },
});
