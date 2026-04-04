import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseTrendingResults } from '../../shared/parsers.js';
import { clampLimit } from './search.js';

export function normalizeCitySlug(city: string): string {
  return city.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function buildTrendingEvaluate(limit: number): string {
  return `
    (async () => {
      const limit = ${limit};
      const str = (v) => v == null ? '' : String(v).trim();

      // Strategy 1: __NEXT_DATA__
      const byBootstrap = () => {
        const globals = [
          window.__NEXT_DATA__?.props?.pageProps,
          window.__INITIAL_STATE__,
        ];
        for (const g of globals) {
          if (!g || typeof g !== 'object') continue;
          const queue = [g];
          while (queue.length) {
            const node = queue.shift();
            if (Array.isArray(node) && node.length >= 2 && node[0]?.title) {
              return node.slice(0, limit).map((item) => ({
                title: str(item.title),
                price: str(item.price || item.salePrice || item.marketPrice),
                currency: str(item.currency || item.currencyCode || ''),
                starScore: str(item.starScore || item.score || item.rating),
                reviewCount: str(item.reviewCount || item.reviewTotal),
                categoryName: str(item.categoryName || item.category),
                cityName: str(item.cityName || item.city || ''),
                deeplink: str(item.deeplink || item.url || item.seoUrl),
              }));
            }
            if (node && typeof node === 'object' && !Array.isArray(node)) {
              for (const v of Object.values(node)) queue.push(v);
            }
          }
        }
        return [];
      };

      // Strategy 2: DOM — trending/popular sections
      const byDom = () => {
        const sections = document.querySelectorAll(
          '[data-testid*="trending"], [data-testid*="popular"], [class*="trending"], [class*="popular"], [class*="recommend"], .top-activities'
        );
        let cards = [];
        for (const section of sections) {
          cards = Array.from(section.querySelectorAll('a[href*="/activity/"]'));
          if (cards.length) break;
        }
        if (!cards.length) {
          cards = Array.from(document.querySelectorAll('a[href*="/activity/"]'));
        }
        const seen = new Set();
        return cards
          .map((el) => {
            const href = str(el.getAttribute('href'));
            if (!href || seen.has(href)) return null;
            seen.add(href);
            const root = el.closest('[data-testid*="card"]') || el;
            const title = str(root.querySelector('h3, h4, .title, [class*="title"]')?.textContent);
            const priceEl = root.querySelector('[class*="price"]');
            const price = str(priceEl?.textContent).replace(/[^\d,.]/g, '');
            const currency = str(priceEl?.textContent).replace(/[\d,.\s]/g, '').trim();
            const rating = str(root.querySelector('[class*="rating"], .star')?.textContent).match(/[\d.]+/)?.[0] || '';
            const reviewCount = str(root.querySelector('[class*="review"]')?.textContent).replace(/[^\d]/g, '');
            const category = str(root.querySelector('[class*="category"], .tag')?.textContent);
            return { title, price, currency, starScore: rating, reviewCount, categoryName: category, cityName: '', deeplink: href };
          })
          .filter(Boolean)
          .slice(0, limit);
      };

      let items = byBootstrap();
      if (!items.length) items = byDom();

      return { items };
    })()
  `;
}

cli({
  site: 'klook',
  name: 'trending',
  description: 'Show trending activities for a city on Klook',
  domain: 'www.klook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'city', required: true, positional: true, help: 'City name (e.g. "osaka", "tokyo", "hong-kong")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
  ],
  columns: ['rank', 'title', 'price', 'currency', 'rating', 'review_count', 'category', 'url'],
  func: async (page: IPage, kwargs) => {
    const city = String(kwargs.city || '').trim();
    if (!city) throw new Error('City name is required');

    const slug = normalizeCitySlug(city);
    const limit = clampLimit(kwargs.limit, 10);
    const url = `https://www.klook.com/city/${slug}/`;

    await page.goto(url);
    await page.autoScroll({ times: 2, delayMs: 1500 });

    const raw = await page.evaluate(buildTrendingEvaluate(limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseTrendingResults(items, limit);

    if (!results.length) {
      throw new Error(`No trending activities found for "${city}". Check the city name or your Klook login.`);
    }
    return results;
  },
});

export const __test__ = { normalizeCitySlug };
