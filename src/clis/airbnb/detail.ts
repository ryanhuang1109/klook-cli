/**
 * airbnb/detail — Airbnb Experience detail with packages and pricing hints.
 *
 * Airbnb is a React SPA: title in h1, description in meta, sections rendered
 * as h2 blocks. The booking widget sits in a sticky sidebar and shows price
 * per person / per guest. Cancellation policy renders as an explicit h2.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs, getCancellationExtractorJs, getSectionWalkerJs } from '../../shared/section-map.js';

export function parseExperienceId(input: string): string {
  const urlMatch = input.match(/\/experiences\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input;
}

export function buildDetailEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      ${getSectionMapJs()}
      ${getCancellationExtractorJs()}
      ${getSectionWalkerJs()}

      const title = str(document.querySelector('h1')?.textContent);
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      const bodyText = document.body.innerText;

      // Rating + review count.
      //
      // Airbnb embeds a schema.org Product JSON-LD blob in the head with
      // aggregateRating.ratingValue / reviewCount — that's locale-
      // independent and survives partial hydration. Diagnostic dump
      // 2026-04-28 confirmed body.innerText is < 3KB on these pages
      // (just the no-JS notice) until React fully renders, so any
      // bodyText-based fallback is fragile. JSON-LD first, then aria-
      // label patterns covering en / zh-TW / ja / ko, then bodyText as
      // last resort.
      let starScore = '', reviewCount = '';
      let ldProduct = null;
      for (const ldNode of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(ldNode.textContent || '');
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of arr) {
            if (obj && obj['@type'] === 'Product') { ldProduct = obj; break; }
          }
        } catch (_) { /* ignore malformed json-ld */ }
        if (ldProduct) break;
      }
      if (ldProduct && ldProduct.aggregateRating) {
        if (ldProduct.aggregateRating.ratingValue != null) {
          starScore = String(ldProduct.aggregateRating.ratingValue);
        }
        // schema.org AggregateRating uses ratingCount; some sites also emit
        // reviewCount. Accept either.
        const cnt = ldProduct.aggregateRating.reviewCount
                 ?? ldProduct.aggregateRating.ratingCount;
        if (cnt != null) reviewCount = String(cnt) + ' reviews';
      }
      // Aria-label fallback for any locale: "Rated 4.99 out of 5",
      // "獲得 4.99 星評分", "5つ星のうち 4.99 の評価", "5점 만점에 4.99점" etc.
      if (!starScore) {
        for (const node of document.querySelectorAll('[aria-label]')) {
          const aria = node.getAttribute('aria-label') || '';
          const am = aria.match(/(\\d+\\.\\d{1,2})\\s*(?:out of|stars?|星評分|星评分|の評価|점|점\\s*만점)/i);
          if (am) { starScore = am[1]; break; }
        }
      }
      // Body-text last resort. Use textContent (innerText is hydration-empty).
      if (!starScore || !reviewCount) {
        const tc = document.body.textContent || '';
        if (!starScore) {
          const m = tc.match(/(\\d+\\.\\d{1,2})\\s*[★·\\u00b7\\u2605]\\s*(\\d[\\d,]*)\\s*reviews?/i)
                 || tc.match(/★\\s*(\\d+\\.\\d{1,2})/)
                 || tc.match(/(\\d+\\.\\d{1,2})\\s*(?:out of 5)/i);
          if (m) starScore = m[1];
        }
        if (!reviewCount) {
          const rm = tc.match(/\\((\\d[\\d,]*)\\s*reviews?\\)/i);
          if (rm) reviewCount = rm[1].replace(/,/g, '') + ' reviews';
        }
      }

      // Supplier: prefer the business name ("Owner of <Business>" / "Founder
      // of <Business>") which sits one line below "Hosted by <Person>" — the
      // business is the right field for cross-platform comparison; the host's
      // first name alone is too generic.
      let supplier = '';
      const businessMatch = bodyText.match(/(?:Owner of|Founder of|Hosted by company)\\s+([^\\n,]{2,80})/i);
      if (businessMatch) {
        supplier = businessMatch[1].trim().slice(0, 120);
      } else {
        const hostMatch = bodyText.match(/Hosted by\\s+([^\\n,]{2,80})/i);
        if (hostMatch) supplier = hostMatch[1].trim().slice(0, 120);
      }

      // City + category: when present, Airbnb renders "<city> · <category>"
      // right above the host card. The actual innerText is split with a stray
      // comma between the city and the dot:
      //   "1,865 reviews\\nKyoto\\n,\\n · Cultural tours\\nHosted by Mai"
      // So we anchor on "[N] reviews" + newline, take the city as the next
      // non-empty line, then look for "· <category>" within a short window.
      // Some experiences omit this line entirely (e.g. older or multi-location
      // tours); we leave city/category empty rather than guess.
      let cityName = '', categoryName = '';
      const cityCatMatch = bodyText.match(
        /[\\d,]+\\s*reviews?\\s*\\n([A-Z][^\\n]{1,40})\\s*\\n[,\\s]*·\\s*([^\\n]{2,60})/
      );
      if (cityCatMatch) {
        cityName = cityCatMatch[1].trim();
        categoryName = cityCatMatch[2].trim();
      }

      // Booking counter is not surfaced on Airbnb experience pages — leave blank.
      const bookCount = '';

      // Images: Airbnb hero gallery is on a0.muscache.com under paths
      // /im/pictures/Mt/MtTemplate-<experience-id>/ (template hosts) or
      // /im/pictures/miso/Hosting-... (booking-page hero). The same DOM
      // also embeds search-bar icons and platform asset SVGs that we
      // do not want — first one wins downstream as first_image, so a
      // single mis-pick replaces the cover thumbnail with a UI icon.
      // Reject platform-asset paths and SVGs; the rest of the broad
      // muscache scan stays so lazy-loaded product photos still land.
      const seenImgs = new Set();
      const images = Array.from(document.querySelectorAll(
        'img[src*="airbnb"], img[src*="muscache"], picture source[srcset*="muscache"]'
      ))
        .map((el) => el.getAttribute('src') || (el.getAttribute('srcset') || '').split(' ')[0])
        .filter((src) =>
          src
          && !src.includes('/airbnb-platform-assets/')   // search-bar / nav icons
          && !src.includes('/icons/')                      // generic icon path
          && !src.toLowerCase().endsWith('.svg')           // SVGs are logos / icons
          && !seenImgs.has(src)
          && (seenImgs.add(src), true)
        )
        .slice(0, 10);

      // ── Sections: scrape h2/h3 ──
      const sections = [];
      const seenSections = new Set();
      const allHeadings = Array.from(document.querySelectorAll('h2, h3'));

      for (const h of allHeadings) {
        const orig = str(h.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        seenSections.add(orig.toLowerCase());
        // Use sibling-walk first; .closest('section') over-captures because
        // Airbnb groups several h2s under the same outer <section> (e.g.
        // Cancellation policy + Things to know + Guest requirements).
        const rawContent = extractSectionUntilNextHeading(
          h,
          'section, [role="region"], [class*="section"]'
        );
        const content = str(rawContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '').replace(/Read (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // ── Inclusions / Exclusions ──
      // Airbnb usually labels these "What you'll do", "What's included", and
      // sometimes "What to bring" / "Not allowed".
      let inclusions = [], exclusions = [];
      const inclH = allHeadings.find(h => /what.?s included|what you.?ll get|includes/i.test(str(h.textContent)));
      if (inclH) {
        const sec = inclH.closest('section, [role="region"]') || inclH.parentElement;
        const lists = sec?.querySelectorAll('ul') || [];
        if (lists.length >= 2) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
          exclusions = Array.from(lists[1].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        } else if (lists.length === 1) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }

      // ── Itinerary ──
      // Many Airbnb experiences don't have a strict itinerary; "What you'll do"
      // is the closest equivalent, sometimes broken into steps.
      const itinerary = [];
      const itinH = allHeadings.find(h => /what you.?ll do|itinerary|schedule/i.test(str(h.textContent)));
      if (itinH) {
        const sec = itinH.closest('section, [role="region"]') || itinH.parentElement;
        const items = sec?.querySelectorAll('[class*="step"], li, [role="listitem"]') || [];
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
      // Airbnb experiences typically have a single "package" — the experience
      // itself — with optional private/group variants. We synthesize one
      // package from the booking widget price + title.
      const packages = [];
      const bookingBar = document.querySelector(
        '[data-section-id*="BOOKING"], [data-testid*="book-it"], [class*="book-it"], aside'
      );
      let basePrice = '';
      if (bookingBar) {
        const barText = str(bookingBar.textContent);
        const priceMatch = barText.match(/([\\$€£¥]\\s*[\\d,.]+)/);
        if (priceMatch) basePrice = priceMatch[1];
      }
      if (basePrice || title) {
        packages.push({
          name: title || 'Experience',
          description: '',
          inclusions,
          exclusions,
          price: basePrice,
          currency: basePrice.match(/^[\\$€£¥]/)?.[0] || '',
          originalPrice: '',
          discount: '',
          date: '',
          availability: 'Available',
        });
      }

      // Cancellation policy: Airbnb typically renders an h2 "Cancellation
      // policy" with a paragraph; the section walker captures it. Body-text
      // fallback handles cases where the heading is missing.
      const cancelSection = sections.find((s) => s.title === 'Cancellation policy');
      let cancellationPolicy = cancelSection ? cancelSection.content : '';
      if (!cancellationPolicy) cancellationPolicy = extractCancellationFromBody(bodyText);

      // TEMP DIAG — dump aria-labels + a body slice to figure out where the
      // rating widget hides on the current Airbnb DOM. Remove once selector
      // is fixed.

      return {
        title,
        description,
        cityName,
        categoryName,
        starScore,
        reviewCount,
        bookCount,
        supplier,
        images,
        itinerary,
        packages,
        sections,
        cancellationPolicy,
        url: location.href,
      };
    })()
  `;
}

cli({
  site: 'airbnb',
  name: 'get-activity',
  aliases: ['detail', 'get-experience'],
  description: 'Show Airbnb Experience detail with host, sections, and price',
  domain: 'www.airbnb.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'experience', required: true, positional: true, help: 'Experience ID or URL (e.g. "1234567" or full Airbnb URL)' },
  ],
  columns: ['title', 'rating', 'review_count'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.experience || '').trim();
    if (!input) throw new Error('Experience ID or URL is required');

    const experienceId = parseExperienceId(input);
    const baseUrl = input.startsWith('http')
      ? input
      : `https://www.airbnb.com/experiences/${experienceId}`;

    // Default to English unless the caller has already pinned a locale.
    // The Browser Bridge cookie often defaults to whatever locale the
    // operator last browsed in (zh-TW, ja, etc.), which would otherwise
    // produce localised titles / descriptions in our DB. Verified that
    // ?locale=en-US overrides the cookie hint for the page navigation.
    let url = baseUrl;
    try {
      const u = new URL(baseUrl);
      if (!u.searchParams.has('locale')) {
        u.searchParams.set('locale', 'en-US');
        url = u.toString();
      }
    } catch { /* malformed URL — fall back to raw input */ }

    await page.goto(url);
    // Airbnb hydrates the booking widget after initial render; wait + scroll.
    await page.wait(5000);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    const raw = await page.evaluate(buildDetailEvaluate()) as any;
    if (!raw || !raw.title) {
      throw new Error(
        'Could not extract experience detail from Airbnb. The page may have rendered a bot challenge or the experience is region-locked.',
      );
    }

    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseExperienceId };
