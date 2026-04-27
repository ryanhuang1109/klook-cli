/**
 * airbnb/search — Search Airbnb Experiences via Browser Bridge.
 *
 * Airbnb is a React SPA with aggressive bot protection (PerimeterX). Search
 * cards link out to /experiences/<id>. Selectors are conservative — expect to
 * iterate after the first real-site run.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { clampLimit } from '../klook/search.js';
import { parseSearchResults } from '../../shared/parsers.js';

export function buildSearchEvaluate(limit: number): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      // Experience cards link to /experiences/<id>. Filter on that pattern
      // — Airbnb mixes stays cards into the same search shell.
      const links = document.querySelectorAll('a[href*="/experiences/"]');
      const seen = new Set();
      const items = [];
      for (const a of links) {
        const href = str(a.getAttribute('href'));
        const idMatch = href.match(/\\/experiences\\/(\\d+)/);
        if (!idMatch || seen.has(idMatch[1])) continue;
        seen.add(idMatch[1]);
        const card = a.closest('[itemtype], [data-testid*="card"], article, li, div[role="group"]') || a;
        const text = str(card.textContent);
        // Title: Airbnb renders card titles in <span> with a meta itemprop="name"
        // attribute, or a heading-like span near the top of the card.
        const titleEl =
          card.querySelector('[itemprop="name"]') ||
          card.querySelector('[data-testid*="title"], h3, h2');
        const title = str(titleEl?.textContent || a.textContent).slice(0, 200);
        // Price: "From $35 / person" or "$35 per person" — currency varies by locale
        const priceMatch = text.match(/(?:From\\s*)?([\\$€£¥]\\s*[\\d,.]+(?:\\s*\\/\\s*(?:person|guest))?)/i);
        // Rating + review count: "4.92 (127)" or "4.9 ★ (127 reviews)"
        const ratingMatch = text.match(/(\\d\\.\\d{1,2})\\s*(?:\\(|★|out of)/);
        const reviewMatch = text.match(/\\((\\d[\\d,]*)\\s*(?:reviews?|ratings?)?\\)/i);
        // City/location chip
        const locEl = card.querySelector('[data-testid*="location"], [class*="location"], [class*="city"]');
        const city = str(locEl?.textContent);
        items.push({
          title,
          price: priceMatch ? priceMatch[1] : '',
          currency: '',
          starScore: ratingMatch ? ratingMatch[1] : '',
          reviewCount: reviewMatch ? reviewMatch[1] + ' reviews' : '',
          categoryName: '',
          cityName: city,
          deeplink: href.startsWith('http') ? href : 'https://www.airbnb.com' + href,
        });
        if (items.length >= ${limit}) break;
      }
      return { items };
    })()
  `;
}

cli({
  site: 'airbnb',
  name: 'search-activities',
  aliases: ['search', 'search-experiences'],
  description: 'Search Airbnb Experiences',
  domain: 'www.airbnb.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Tokyo food tour")' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
  ],
  columns: ['rank', 'title', 'price', 'rating', 'review_count', 'city', 'url'],
  func: async (page: IPage, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    // Experiences-only search route. Airbnb interprets the slug after /s/ as
    // a free-text location query, then /experiences scopes to the experience tab.
    const url = `https://www.airbnb.com/s/${encodeURIComponent(query)}/experiences`;

    await page.goto(url);
    // Airbnb hydrates lazily; an autoscroll triggers the lazy-loaded card grid.
    await page.wait(4000);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error(
        'No results found on Airbnb. The page may have rendered a bot challenge — try refreshing the Browser Bridge cookie via `opencli doctor`, or verify the search URL in a real browser.',
      );
    }
    return results;
  },
});
