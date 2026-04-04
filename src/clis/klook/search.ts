import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseSearchResults } from '../../shared/parsers.js';

export function clampLimit(raw: unknown, fallback = 20): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 50));
}

export function buildSearchEvaluate(query: string, limit: number): string {
  return `
    (async () => {
      const query = ${JSON.stringify(query)};
      const limit = ${limit};
      const str = (v) => v == null ? '' : String(v).trim();

      // Strategy 1: intercept __NEXT_DATA__ or global state
      const byBootstrap = () => {
        const globals = [
          window.__NEXT_DATA__?.props?.pageProps,
          window.__INITIAL_STATE__,
          window.__PRELOADED_STATE__,
        ];
        for (const g of globals) {
          if (!g || typeof g !== 'object') continue;
          const queue = [g];
          while (queue.length) {
            const node = queue.shift();
            if (Array.isArray(node) && node.length > 2 && node[0]?.title) {
              return node.slice(0, limit).map((item) => ({
                title: str(item.title),
                price: str(item.price || item.salePrice || item.marketPrice),
                currency: str(item.currency || item.currencyCode || ''),
                starScore: str(item.starScore || item.score || item.rating),
                reviewCount: str(item.reviewCount || item.reviewTotal || item.commentCount),
                categoryName: str(item.categoryName || item.category || ''),
                cityName: str(item.cityName || item.city || ''),
                deeplink: str(item.deeplink || item.url || item.seoUrl || ''),
              }));
            }
            if (node && typeof node === 'object' && !Array.isArray(node)) {
              for (const v of Object.values(node)) queue.push(v);
            }
          }
        }
        return [];
      };

      // Strategy 2: JSON-LD
      const byJsonLd = () => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          try {
            const data = JSON.parse(s.textContent || '');
            const items = data?.itemListElement || [];
            if (Array.isArray(items) && items.length) {
              return items.slice(0, limit).map((entry) => {
                const item = entry?.item || entry;
                return {
                  title: str(item?.name),
                  price: str(item?.offers?.price || item?.offers?.lowPrice),
                  currency: str(item?.offers?.priceCurrency),
                  starScore: str(item?.aggregateRating?.ratingValue),
                  reviewCount: str(item?.aggregateRating?.reviewCount),
                  categoryName: str(item?.category),
                  cityName: '',
                  deeplink: str(item?.url),
                };
              });
            }
          } catch {}
        }
        return [];
      };

      // Strategy 3: DOM scraping
      const byDom = () => {
        const cards = Array.from(document.querySelectorAll(
          '[data-testid="activity-card"], .js-card, .act_card, a[href*="/activity/"]'
        ));
        const seen = new Set();
        return cards
          .map((el) => {
            const root = el.closest('[data-testid="activity-card"]') || el.closest('.js-card') || el;
            const link = root.querySelector('a[href*="/activity/"]');
            const href = str(link?.getAttribute('href'));
            if (!href || seen.has(href)) return null;
            seen.add(href);
            const title = str(
              root.querySelector('[data-testid="activity-title"], .title, h3, h4')?.textContent
            );
            const priceEl = root.querySelector('[data-testid="activity-price"], .price, [class*="price"]');
            const price = str(priceEl?.textContent).replace(/[^\d,.]/g, '');
            const currency = str(priceEl?.textContent).replace(/[\d,.\s]/g, '').trim();
            const ratingEl = root.querySelector('[data-testid="activity-rating"], .star, [class*="rating"]');
            const rating = str(ratingEl?.textContent).match(/[\d.]+/)?.[0] || '';
            const reviewEl = root.querySelector('[data-testid="activity-reviews"], .review, [class*="review"]');
            const reviewCount = str(reviewEl?.textContent).replace(/[^\d]/g, '');
            const category = str(root.querySelector('[class*="category"], .tag')?.textContent);
            return { title, price, currency, starScore: rating, reviewCount, categoryName: category, cityName: '', deeplink: href };
          })
          .filter(Boolean)
          .slice(0, limit);
      };

      let items = byBootstrap();
      if (!items.length) items = byJsonLd();
      if (!items.length) items = byDom();

      return { items };
    })()
  `;
}

cli({
  site: 'klook',
  name: 'search',
  description: 'Search Klook activities, tickets, and experiences',
  domain: 'www.klook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (e.g. "Tokyo Disneyland")' },
    { name: 'city', help: 'Filter by city name' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
    { name: 'sort', choices: ['price', 'rating', 'popular'], help: 'Sort order' },
  ],
  columns: ['rank', 'title', 'price', 'currency', 'rating', 'review_count', 'category', 'city', 'url'],
  func: async (page: IPage, kwargs) => {
    const query = String(kwargs.query || '').trim();
    if (!query) throw new Error('Search query is required');

    const limit = clampLimit(kwargs.limit);
    const sortParam = kwargs.sort ? `&sort=${kwargs.sort}` : '';
    const cityParam = kwargs.city ? `&city=${encodeURIComponent(kwargs.city)}` : '';
    const url = `https://www.klook.com/search/?query=${encodeURIComponent(query)}${cityParam}${sortParam}`;

    await page.goto(url);
    await page.autoScroll({ times: 2, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(query, limit));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const results = parseSearchResults(items, limit);

    if (!results.length) {
      throw new Error('No results found. Try different keywords or check your Klook login in Chrome.');
    }
    return results;
  },
});

export const __test__ = { clampLimit };
