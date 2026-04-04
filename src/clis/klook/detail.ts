import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';

export function parseActivityId(input: string): string {
  const urlMatch = input.match(/\/activity\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input;
}

export function buildDetailEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();

      // Strategy 1: __NEXT_DATA__
      const byBootstrap = () => {
        const pageProps = window.__NEXT_DATA__?.props?.pageProps;
        if (!pageProps) return null;

        const queue = [pageProps];
        while (queue.length) {
          const node = queue.shift();
          if (!node || typeof node !== 'object') continue;
          if (node.title && (node.packages || node.options || node.description)) {
            const pkgSource = node.packages || node.options || [];
            return {
              title: str(node.title),
              description: str(node.description || node.summary || node.intro),
              cityName: str(node.cityName || node.city),
              categoryName: str(node.categoryName || node.category),
              starScore: str(node.starScore || node.score || node.rating),
              reviewCount: str(node.reviewCount || node.reviewTotal || node.commentCount),
              images: (node.images || node.photos || node.gallery || [])
                .map((img) => str(typeof img === 'string' ? img : img?.url || img?.src))
                .filter(Boolean),
              itinerary: (node.itinerary || node.schedule || []).map((step) => ({
                time: str(step.time || step.startTime),
                title: str(step.title || step.name),
                description: str(step.description || step.content),
              })),
              packages: Array.isArray(pkgSource) ? pkgSource.map((pkg) => ({
                name: str(pkg.name || pkg.title),
                description: str(pkg.description || pkg.intro),
                inclusions: Array.isArray(pkg.inclusions) ? pkg.inclusions.map(str) : [],
                exclusions: Array.isArray(pkg.exclusions) ? pkg.exclusions.map(str) : [],
                price: str(pkg.price || pkg.salePrice),
                currency: str(pkg.currency || pkg.currencyCode),
                originalPrice: str(pkg.originalPrice || pkg.marketPrice),
                discount: str(pkg.discount || pkg.discountTag),
                date: str(pkg.date || pkg.useDate),
                availability: str(pkg.availability || pkg.status || 'unknown'),
              })) : [],
              url: location.href,
            };
          }
          if (!Array.isArray(node)) {
            for (const v of Object.values(node)) queue.push(v);
          }
        }
        return null;
      };

      // Strategy 2: DOM scraping
      const byDom = () => {
        const title = str(document.querySelector('h1, [data-testid="activity-title"]')?.textContent);
        const description = str(
          document.querySelector('[data-testid="activity-description"], .activity-intro, [class*="description"]')?.textContent
        );
        const images = Array.from(document.querySelectorAll(
          '[data-testid="gallery"] img, .activity-gallery img, .swiper img, [class*="gallery"] img'
        )).map((img) => img.getAttribute('src') || '').filter(Boolean);

        const ratingEl = document.querySelector('[data-testid="activity-rating"], [class*="rating"]');
        const rating = str(ratingEl?.textContent).match(/[\\d.]+/)?.[0] || '';
        const reviewCount = str(
          document.querySelector('[data-testid="activity-reviews"], [class*="review"]')?.textContent
        ).replace(/[^\\d]/g, '');

        const pkgEls = document.querySelectorAll(
          '[data-testid="package-card"], [class*="package-option"], [class*="sku-card"], .package-card'
        );
        const packages = Array.from(pkgEls).map((el) => {
          const name = str(el.querySelector('[class*="package-name"], .name, h3, h4')?.textContent);
          const priceEl = el.querySelector('[class*="price"]');
          const price = str(priceEl?.textContent).replace(/[^\\d,.]/g, '');
          const currency = str(priceEl?.textContent).replace(/[\\d,.\\s]/g, '').trim();
          const originalEl = el.querySelector('del, [class*="original"], [class*="line-through"]');
          const originalPrice = str(originalEl?.textContent).replace(/[^\\d,.]/g, '');
          const discount = str(el.querySelector('[class*="discount"], [class*="off"]')?.textContent);
          const availability = str(el.querySelector('[class*="availability"], [class*="sold-out"]')?.textContent) || 'Available';
          return {
            name,
            description: str(el.querySelector('[class*="desc"]')?.textContent),
            inclusions: [],
            exclusions: [],
            price,
            currency,
            originalPrice,
            discount,
            date: '',
            availability,
          };
        });

        return {
          title,
          description,
          cityName: '',
          categoryName: '',
          starScore: rating,
          reviewCount,
          images,
          itinerary: [],
          packages,
          url: location.href,
        };
      };

      const result = byBootstrap() || byDom();
      return result;
    })()
  `;
}

cli({
  site: 'klook',
  name: 'detail',
  description: 'Show full activity detail, itinerary, packages, and pricing from Klook',
  domain: 'www.klook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or full URL (e.g. "1234" or "https://www.klook.com/activity/1234/")' },
    { name: 'date', help: 'Date for pricing (YYYY-MM-DD)' },
  ],
  columns: ['title', 'rating', 'review_count', 'city', 'category'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.klook.com/activity/${activityId}/`;

    await page.goto(url);

    if (kwargs.date) {
      const dateStr = String(kwargs.date);
      await page.evaluate(`
        (() => {
          const dateButtons = document.querySelectorAll('[data-date="${dateStr}"], [aria-label*="${dateStr}"], button, [role="button"]');
          for (const btn of dateButtons) {
            if (btn.textContent?.includes('${dateStr.split('-').pop()}') || btn.getAttribute('data-date') === '${dateStr}') {
              btn.click();
              return true;
            }
          }
          return false;
        })()
      `);
      await page.wait(2000);
    }

    await page.autoScroll({ times: 3, delayMs: 1000 });
    const raw = await page.evaluate(buildDetailEvaluate());

    if (!raw || !raw.title) {
      throw new Error('Could not extract activity detail. The page structure may have changed or login may be required.');
    }

    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseActivityId };
