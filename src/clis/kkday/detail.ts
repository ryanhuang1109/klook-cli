/**
 * kkday/detail — KKday activity detail with package pricing.
 *
 * KKday has rich package structure: category tabs (Admission, Bundle, VIP)
 * with h3 package names and price elements. Product URL: /en/product/{id}
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs } from '../../shared/section-map.js';

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
      ${getSectionMapJs()}

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

      // ── Sections: capture all h2/h3 sections ──
      const sections = [];
      const seenSections = new Set();
      const allHeadings = Array.from(document.querySelectorAll('h2, h3'));

      for (const h of allHeadings) {
        const orig = str(h.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        // Skip package-like h3 headings (those are handled below)
        if (h.tagName === 'H3' && /pass|ticket|tour|bundle|voucher|vip|admission/i.test(orig)) continue;
        seenSections.add(orig.toLowerCase());
        const sec = h.closest('section, [class*="section"], [class*="module"], [class*="content-block"]') || h.parentElement;
        const content = str(sec?.textContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '').replace(/Read (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // ── Inclusions / Exclusions ──
      let inclusions = [], exclusions = [];
      const inclH = allHeadings.find(h => /included|what you.?ll get|inclusions/i.test(str(h.textContent)));
      if (inclH) {
        const sec = inclH.closest('section, [class*="section"], [class*="module"]') || inclH.parentElement;
        const lists = sec?.querySelectorAll('ul') || [];
        if (lists.length >= 2) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
          exclusions = Array.from(lists[1].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        } else if (lists.length === 1) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }
      // Separate exclusions heading
      if (!exclusions.length) {
        const exclH = allHeadings.find(h => /not included|excludes|excluded|exclusions/i.test(str(h.textContent)));
        if (exclH) {
          const sec = exclH.closest('section, [class*="section"]') || exclH.parentElement;
          const list = sec?.querySelector('ul');
          if (list) exclusions = Array.from(list.querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }

      // ── Itinerary ──
      const itinerary = [];
      const itinH = allHeadings.find(h => /itinerary|schedule|timeline/i.test(str(h.textContent)));
      if (itinH) {
        const sec = itinH.closest('section, [class*="section"], [class*="module"]') || itinH.parentElement;
        const items = sec?.querySelectorAll('[class*="step"], [class*="timeline"], [class*="item"], li') || [];
        const seenItin = new Set();
        for (const item of Array.from(items).slice(0, 30)) {
          const text = str(item.textContent).slice(0, 300);
          if (!text || seenItin.has(text)) continue;
          seenItin.add(text);
          const timeMatch = text.match(/(\\d{1,2}:\\d{2})/);
          itinerary.push({
            time: timeMatch ? timeMatch[1] : '',
            title: text.replace(timeMatch?.[0] || '', '').trim().slice(0, 200),
            description: '',
          });
        }
      }

      // ── Packages ──
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

        // Package description from nearby description element
        const descEl = parent?.querySelector('[class*="desc"], [class*="info"], [class*="detail"], p');
        const pkgDesc = descEl ? str(descEl.textContent).slice(0, 500) : (bookingStart ? 'Booking starts: ' + bookingStart : '');

        packages.push({
          name,
          description: pkgDesc,
          inclusions,
          exclusions,
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
        itinerary,
        packages,
        sections,
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
