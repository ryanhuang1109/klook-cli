/**
 * kkday/detail — KKday activity detail with package pricing.
 *
 * KKday has rich package structure: category tabs (Admission, Bundle, VIP)
 * with h3 package names and price elements. Product URL: /en/product/{id}
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';

export function parseProductId(input: string): string {
  const urlMatch = input.match(/\/product\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input;
}

export function buildDetailEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();

      const title = str(document.querySelector('h1')?.textContent);
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      // Rating + reviews
      const bodyText = document.body.innerText;
      const ratingMatch = bodyText.match(/(\\d\\.\\d)\\s*(?:\\(|\\/)/) || bodyText.match(/(\\d\\.\\d)/);
      const starScore = ratingMatch ? ratingMatch[1] : '';
      const reviewMatch = bodyText.match(/([\\d,]+[KkMm]?)\\+?\\s*reviews?/i);
      const reviewCount = reviewMatch ? reviewMatch[0] : '';

      // Images
      const seenImgs = new Set();
      const images = Array.from(document.querySelectorAll('img[src*="kkday"], img[src*="cdn"]'))
        .map((img) => img.src)
        .filter((src) => (src.includes('product') || src.includes('image')) && !seenImgs.has(src) && (seenImgs.add(src), true))
        .slice(0, 10);

      // Packages from h3 headings that match ticket/pass/tour patterns
      const h3s = Array.from(document.querySelectorAll('h3'));
      const packages = [];
      for (const h3 of h3s) {
        let name = str(h3.textContent);
        if (!name || name.length < 5 || name.length > 200) continue;
        if (!/pass|ticket|tour|bundle|voucher|nintendo|vip|admission|experience/i.test(name)) continue;
        // Clean "Use instantly" suffix
        name = name.replace(/Use instantly$/i, '').trim();

        // Find price near this heading
        const parent = h3.closest('[class*="package"], [class*="option"], section, li, article') || h3.parentElement;
        let price = '';
        if (parent) {
          const priceEl = parent.querySelector('[class*="price"]');
          if (priceEl) {
            const priceText = str(priceEl.textContent).replace(/\\n/g, ' ');
            const match = priceText.match(/((?:US|TWD|HK|JPY|EUR)\\$?\\s*[\\d,.]+)/);
            price = match ? match[1] : '';
          }
        }

        // Check availability
        const parentText = str(parent?.textContent || '');
        const soldOut = /sold out|unavailable/i.test(parentText);
        const bookingStart = parentText.match(/Booking starts:\\s*([\\d-]+)/)?.[1] || '';

        packages.push({
          name,
          description: bookingStart ? 'Booking starts: ' + bookingStart : '',
          inclusions: [],
          exclusions: [],
          price,
          currency: price.match(/^[A-Z]+\\$?/)?.[0] || '',
          originalPrice: '',
          discount: '',
          date: bookingStart || '',
          availability: soldOut ? 'Sold out' : 'Available',
        });
      }

      return {
        title,
        description,
        cityName: '',
        categoryName: '',
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
  site: 'kkday',
  name: 'detail',
  description: 'Show KKday activity detail with package pricing',
  domain: 'www.kkday.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or URL (e.g. "2247" or full KKday URL)' },
  ],
  columns: ['title', 'rating', 'review_count'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.product || '').trim();
    if (!input) throw new Error('Product ID or URL is required');

    const productId = parseProductId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.kkday.com/en/product/${productId}`;

    await page.goto(url);
    await page.wait(5000);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildDetailEvaluate());
    if (!raw || !raw.title) {
      throw new Error('Could not extract product detail from KKday.');
    }
    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseProductId };
