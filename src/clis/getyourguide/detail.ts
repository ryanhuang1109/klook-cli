/**
 * getyourguide/detail — GetYourGuide activity detail with pricing.
 *
 * GYG uses SSR. Title in h1, price in sticky booking bar,
 * rating/reviews in body text, includes/excludes in sections.
 * Activity URL pattern: /city-lXXX/title-tXXX/
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs } from '../../shared/section-map.js';

export function parseActivityId(input: string): string {
  const urlMatch = input.match(/-t(\d+)/);
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

      // Rating + reviews from body text
      const bodyText = document.body.innerText;
      const ratingMatch = bodyText.match(/(\\d\\.\\d)\\s*\\/\\s*5/);
      const starScore = ratingMatch ? ratingMatch[1] : '';
      const reviewMatch = bodyText.match(/([\\d,]+)\\s*reviews?/i);
      const reviewCount = reviewMatch ? reviewMatch[1] + ' reviews' : '';

      // Price from sticky booking bar — GYG uses "From$60" format (no space)
      const bookingBar = document.querySelector('[class*="booking-assistant"], [class*="sticky-booking"]');
      let basePrice = '';
      if (bookingBar) {
        const barText = str(bookingBar.textContent);
        const priceMatch = barText.match(/(?:From\\s*)?([\\$€£]\\s*[\\d,.]+|(?:US\\s*\\$|A\\$|C\\$|S\\$)\\s*[\\d,.]+)/);
        basePrice = priceMatch ? priceMatch[1] : '';
      }

      // Also collect alternative prices from activity-price elements (other ticket types)
      const altPriceEls = document.querySelectorAll('.activity-price, [class*="activity-price"]');
      const altPrices = Array.from(altPriceEls).map((el) => {
        const t = str(el.textContent);
        const m = t.match(/(?:From\\s*)?([\\$€£]\\s*[\\d,.]+)/);
        return m ? m[1] : '';
      }).filter(Boolean);

      // Images
      const seenImgs = new Set();
      const images = Array.from(document.querySelectorAll('img[src*="getyourguide"], img[src*="gyg"]'))
        .map((img) => img.src)
        .filter((src) => !seenImgs.has(src) && (seenImgs.add(src), true))
        .slice(0, 10);

      // ── Sections: capture all h2 sections ──
      const sections = [];
      const seenSections = new Set();
      const allH2s = Array.from(document.querySelectorAll('h2'));

      for (const h2 of allH2s) {
        const orig = str(h2.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        seenSections.add(orig.toLowerCase());
        const sec = h2.closest('section, [class*="section"]') || h2.parentElement;
        const content = str(sec?.textContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '').replace(/Read (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // Also capture h3 sections not already covered
      for (const h3 of document.querySelectorAll('h3')) {
        const orig = str(h3.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        seenSections.add(orig.toLowerCase());
        const sec = h3.closest('section, [class*="section"]') || h3.parentElement;
        const content = str(sec?.textContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // ── Includes / Excludes ──
      let inclusions = [], exclusions = [];
      const includesH = allH2s.find((h) => /^includes$/i.test(str(h.textContent)));
      if (includesH) {
        const section = includesH.closest('section, [class*="section"]') || includesH.parentElement;
        const lists = section?.querySelectorAll('ul') || [];
        if (lists.length >= 2) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map((l) => str(l.textContent)).filter(Boolean);
          exclusions = Array.from(lists[1].querySelectorAll('li')).map((l) => str(l.textContent)).filter(Boolean);
        } else if (lists.length === 1) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map((l) => str(l.textContent)).filter(Boolean);
        }
      }
      // Separate excludes heading
      if (!exclusions.length) {
        const exclH = allH2s.find(h => /excludes|not included/i.test(str(h.textContent)));
        if (exclH) {
          const sec = exclH.closest('section, [class*="section"]') || exclH.parentElement;
          const list = sec?.querySelector('ul');
          if (list) exclusions = Array.from(list.querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }

      // ── Highlights ──
      const highlightsH = allH2s.find((h) => /highlights/i.test(str(h.textContent)));
      let highlights = [];
      if (highlightsH) {
        const section = highlightsH.closest('section, [class*="section"]') || highlightsH.parentElement;
        const lis = section?.querySelectorAll('li') || [];
        highlights = Array.from(lis).map((l) => str(l.textContent)).slice(0, 10);
      }

      // ── Itinerary ──
      const itinerary = [];
      const itinH = allH2s.find(h => /itinerary|schedule/i.test(str(h.textContent)));
      if (itinH) {
        const sec = itinH.closest('section, [class*="section"]') || itinH.parentElement;
        const items = sec?.querySelectorAll('[class*="stop"], [class*="step"], [class*="item"], li') || [];
        const seenItin = new Set();
        for (const item of Array.from(items).slice(0, 30)) {
          const text = str(item.textContent).slice(0, 500);
          if (!text || seenItin.has(text)) continue;
          seenItin.add(text);
          const timeMatch = text.match(/(\\d{1,2}:\\d{2})/);
          const descEl = item.querySelector('[class*="desc"], [class*="content"], p');
          itinerary.push({
            time: timeMatch ? timeMatch[1] : '',
            title: text.replace(timeMatch?.[0] || '', '').trim().slice(0, 200),
            description: descEl ? str(descEl.textContent).slice(0, 500) : '',
          });
        }
      }

      // ── Packages ──
      const packages = [];
      if (basePrice) {
        packages.push({
          name: title,
          description: highlights.join('; '),
          inclusions,
          exclusions,
          price: basePrice,
          currency: basePrice.match(/^[\\$€£]/)?.[0] || '',
          originalPrice: '',
          discount: '',
          date: '',
          availability: 'Available',
        });
      }
      // Add alt-priced variants (express passes, etc.) visible on the page
      const relatedCards = document.querySelectorAll('[class*="recommendation-card"], [class*="also-like"] a');
      for (const card of Array.from(relatedCards).slice(0, 5)) {
        const cardTitle = str(card.querySelector('h3, [class*="title"]')?.textContent);
        const cardPrice = str(card.querySelector('[class*="price"]')?.textContent);
        const priceM = cardPrice.match(/(?:From\\s*)?([\\$€£]\\s*[\\d,.]+)/);
        if (cardTitle && priceM) {
          packages.push({
            name: cardTitle,
            description: '',
            inclusions: [],
            exclusions: [],
            price: priceM[1],
            currency: priceM[1].match(/^[\\$€£]/)?.[0] || '',
            originalPrice: '',
            discount: '',
            date: '',
            availability: 'Available',
          });
        }
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
  site: 'getyourguide',
  name: 'detail',
  description: 'Show GetYourGuide activity detail with pricing and inclusions',
  domain: 'www.getyourguide.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or URL (e.g. "129258" or full GYG URL)' },
  ],
  columns: ['title', 'rating', 'review_count'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const url = input.startsWith('http')
      ? input
      : `https://www.getyourguide.com/activity/t${parseActivityId(input)}/`;

    await page.goto(url);
    await page.wait(5000);
    await page.autoScroll({ times: 2, delayMs: 1000 });

    const raw = await page.evaluate(buildDetailEvaluate());
    if (!raw || !raw.title) {
      throw new Error('Could not extract activity detail from GetYourGuide.');
    }
    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseActivityId };
