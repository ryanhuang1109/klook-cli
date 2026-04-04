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

      // Klook is a Vue 2 app — no __NEXT_DATA__. Extract from DOM directly.
      const title = str(document.querySelector('h1')?.textContent);

      // Description from meta tag (cleaner than DOM text)
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      // Rating + reviews: scan all <span> for patterns
      let starScore = '', reviewCount = '';
      const spans = Array.from(document.querySelectorAll('span'));
      for (const s of spans) {
        const t = str(s.textContent);
        if (!starScore && /^\\d\\.\\d$/.test(t)) { starScore = t; }
        if (!reviewCount && /\\d.*reviews?/i.test(t)) { reviewCount = t; }
      }

      // Images: activity images from Klook CDN
      const seen = new Set();
      const images = Array.from(document.querySelectorAll('img[src*="activities/"]'))
        .map((img) => img.src)
        .filter((src) => {
          if (seen.has(src)) return false;
          seen.add(src);
          return true;
        })
        .slice(0, 10);

      // Breadcrumb for city/category
      const breadcrumbs = Array.from(document.querySelectorAll('#breadCrumb a, [id*="breadCrumb"] a'))
        .map((a) => str(a.textContent))
        .filter(Boolean);
      const cityName = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2] : '';
      const categoryName = breadcrumbs.length >= 1 ? breadcrumbs[breadcrumbs.length - 1] : '';

      // Package prices: find all price strings in the package section
      const pkgSection = document.getElementById('package_option');
      const packages = [];
      if (pkgSection) {
        // Find all visible price elements
        const priceEls = pkgSection.querySelectorAll('[class*="price"], span');
        const priceSet = new Set();
        for (const el of priceEls) {
          const t = str(el.textContent);
          // Match price patterns like "US$ 48.29", "HK$ 450", "TWD 2,400"
          const match = t.match(/^([A-Z]{2,3}\\$?)\\s*([\\d,.]+)$/);
          if (match && !priceSet.has(t)) {
            priceSet.add(t);
            packages.push({
              name: '',
              description: '',
              inclusions: [],
              exclusions: [],
              price: t,
              currency: match[1].trim(),
              originalPrice: '',
              discount: '',
              date: '',
              availability: 'Available',
            });
          }
        }

        // Try to find package names from headings/labels near prices
        const nameEls = pkgSection.querySelectorAll('h3, h4, [class*="name"], [class*="title"]');
        const names = Array.from(nameEls)
          .map((el) => str(el.textContent))
          .filter((t) => t && t.length > 3 && t.length < 200
            && !t.includes('Package options') && !t.includes('Select')
            && !t.includes('Clear') && !t.includes('Quantity'));
        // Assign names to packages if counts align
        for (let i = 0; i < Math.min(names.length, packages.length); i++) {
          packages[i].name = names[i];
        }
      }

      return {
        title,
        description,
        cityName,
        categoryName,
        starScore,
        reviewCount,
        images,
        itinerary: [],
        packages,
        url: location.href,
      };
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error('date must be in YYYY-MM-DD format');
      }
      const day = dateStr.split('-').pop();
      await page.evaluate(`
        (() => {
          const dateStr = ${JSON.stringify(dateStr)};
          const day = ${JSON.stringify(day)};
          const dateButtons = document.querySelectorAll(
            '[data-date="' + dateStr + '"], [aria-label*="' + dateStr + '"], button, [role="button"]'
          );
          for (const btn of dateButtons) {
            if (btn.textContent?.includes(day) || btn.getAttribute('data-date') === dateStr) {
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
