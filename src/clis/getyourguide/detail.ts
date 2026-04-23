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

/**
 * Specific language dropdown scraper — finds the "English"/"Japanese"/etc.
 * button, clicks it, collects the option list. This path is proven to work
 * and should run first; the generic dropdown walker below catches additional
 * variant axes (passenger tier, vehicle etc.).
 */
export function buildLanguageOptionsJs(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const langLabelRe = /^(English|Japanese|Chinese|Mandarin|Korean|French|German|Spanish|Italian|Portuguese|Russian|Thai|Vietnamese|Indonesian|Arabic|Hindi|Dutch|日本語|中文|한국어|Français|Deutsch|Español|Italiano)$/i;
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const langBtn = candidates.find((b) => langLabelRe.test(str(b.textContent)));
      if (!langBtn) return { languages: [] };

      langBtn.click();
      await delay(700);
      const opts = new Set();
      const optEls = Array.from(document.querySelectorAll(
        '[role="option"], [role="radio"], [role="menuitem"], label, [class*="option"] > *'
      ));
      for (const el of optEls) {
        const t = str(el.textContent);
        if (t && langLabelRe.test(t)) opts.add(t);
      }
      const selected = str(langBtn.textContent);
      if (langLabelRe.test(selected)) opts.add(selected);
      document.body.click();
      await delay(250);
      return { languages: Array.from(opts) };
    })()
  `;
}

/**
 * JS to iterate every dropdown in the booking widget and scrape its options.
 *
 * Each dropdown is a package-variant axis — language, vehicle, passenger,
 * guide type, meal plan etc. Calling a single dropdown "language" is too
 * narrow: if a tour has a "Vehicle: SUV / Sedan / Bus" chooser, those are
 * also distinct package options and must be recorded.
 *
 * Returns `{ dimensions: [{ label, options[], selected }, ...] }`. The caller
 * decides which labels map to which canonical fields.
 */
export function buildDropdownOptionsJs(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      // Anchor the booking widget via a language-label button — GYG always
      // renders one in the booking sidebar. Walk up until we find a stable
      // enough container (any ancestor with 2+ dropdown-like buttons).
      const langLabelRe = /^(English|Japanese|Chinese|Mandarin|Korean|French|German|Spanish|Italian|Portuguese|Russian|Thai|Vietnamese|Indonesian|Arabic|Hindi|Dutch|日本語|中文|한국어|Français|Deutsch|Español|Italiano)$/i;
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const langBtn = allButtons.find((b) => langLabelRe.test(str(b.textContent)));

      let booking = null;
      if (langBtn) {
        // Walk up until we find 3+ buttons in the same container (booking widget)
        let el = langBtn.parentElement;
        for (let depth = 0; depth < 8 && el; depth++) {
          const btnCount = el.querySelectorAll('button, [role="button"]').length;
          if (btnCount >= 3) { booking = el; break; }
          el = el.parentElement;
        }
      }

      // Fallback: direct booking-widget selectors (may not all resolve)
      if (!booking) {
        for (const sel of [
          '[class*="booking-assistant"]',
          '[class*="option-picker"]',
          '[class*="activity-sidebar"]',
          '[class*="booking-box"]',
        ]) {
          booking = document.querySelector(sel);
          if (booking) break;
        }
      }
      if (!booking) return { dimensions: [], skipped: 'no-booking-widget' };

      // Labels that look like dropdowns but aren't package variant axes
      const LABEL_BLOCKLIST = /^(recommended|most recent|oldest|highest rated|lowest rated|sort by|filter|see all|show more|show less|read more|read less|help|share|save|close|check availability)$/i;

      // Broaden the selector inside the anchored booking widget — not all GYG
      // dropdowns use aria-haspopup. Any button-like that has a chevron SVG
      // sibling OR is inside a dropdown-ish container is a candidate.
      const triggers = Array.from(
        booking.querySelectorAll('button, [role="button"]')
      ).filter((el) => {
        const t = str(el.textContent);
        if (!t || t.length === 0 || t.length > 80) return false;
        if (LABEL_BLOCKLIST.test(t)) return false;
        // Must look like a chooser — has a chevron/arrow SVG, or aria,
        // or the label pattern looks like a picker
        const hasChevron = !!el.querySelector('svg, [class*="chevron"], [class*="arrow"]');
        const hasAria = el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded');
        const looksLikePicker = /^(Passengers?|Adults?|Date|Language|Time|Option|Vehicle|Guide|Tier)\\b/i.test(t)
          || langLabelRe.test(t);
        return hasChevron || hasAria || looksLikePicker;
      });

      const seen = new Set();
      const uniqueTriggers = [];
      for (const t of triggers) {
        const label = str(t.textContent);
        if (seen.has(label)) continue;
        seen.add(label);
        uniqueTriggers.push(t);
      }

      const dimensions = [];
      for (const trigger of uniqueTriggers.slice(0, 6)) {
        const label = str(trigger.textContent);

        try {
          trigger.click();
          await delay(600);

          // Only look at option lists that just appeared — prefer popovers /
          // portals which usually have role=listbox or role=menu.
          const optEls = Array.from(document.querySelectorAll(
            '[role="option"], [role="radio"], [role="menuitem"]'
          )).filter((el) => {
            const t = str(el.textContent);
            if (!t || t.length === 0 || t.length > 120) return false;
            if (LABEL_BLOCKLIST.test(t)) return false;
            return true;
          });

          const opts = Array.from(
            new Set(optEls.map((el) => str(el.textContent)))
          ).filter((t) => t);

          if (opts.length >= 2) {
            dimensions.push({
              label,
              selected: label,
              options: opts.slice(0, 20),
            });
          }

          document.body.click();
          await delay(250);
        } catch (e) {
          // next
        }
      }

      return { dimensions };
    })()
  `;
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

      // Rating + reviews from body text.
      // GYG renders rating as 4 filled stars + number ("4.3  76,907 reviews")
      // where the number and the "/5" split may not appear. Match both forms.
      const bodyText = document.body.innerText;
      const ratingMatch = bodyText.match(/(\\d\\.\\d)\\s*\\/\\s*5/) ||
                          bodyText.match(/^\\s*(\\d\\.\\d)\\s+[\\d,]+\\s*reviews?/im) ||
                          bodyText.match(/★+\\s*(\\d\\.\\d)\\b/) ||
                          bodyText.match(/(?:^|\\s)(\\d\\.\\d)\\s+[\\d,]+\\s*reviews?/m);
      const starScore = ratingMatch ? ratingMatch[1] : '';
      const reviewMatch = bodyText.match(/([\\d,]+[KM]?)\\s*reviews?/i);
      const reviewCount = reviewMatch ? reviewMatch[1] + ' reviews' : '';

      // Supplier: GYG labels it "Activity provider: <name>" right under the
      // title. Also look for "Offered by" and "Certified by" patterns.
      let supplier = '';
      const supMatch =
        bodyText.match(/Activity provider[\\s:]+([^\\n]{2,120})/i) ||
        bodyText.match(/Offered by[\\s:]+([^\\n]{2,120})/i) ||
        bodyText.match(/Provided by[\\s:]+([^\\n]{2,120})/i);
      if (supMatch) {
        supplier = supMatch[1].trim().replace(/\\s{2,}.*$/, '').slice(0, 120);
      }

      // Order/booking count: GYG shows it as "Booked by X travelers" or
      // "X travelers booked" in some card variants.
      let bookCount = '';
      const bookMatch =
        bodyText.match(/Booked by\\s+([\\d,.]+[KM]?\\+?)\\s+travel/i) ||
        bodyText.match(/([\\d,.]+[KM]?\\+?)\\s+travel(?:ers|lers)\\s+booked/i) ||
        bodyText.match(/([\\d,.]+[KM]?\\+?)\\s+booked/i);
      if (bookMatch) bookCount = bookMatch[1];

      // Badges — GYG uses chips like "Top pick", "Bestseller", "Likely to sell out"
      const badgeMatchers = [
        /top\\s*pick/i, /bestseller/i, /likely to sell out/i,
        /new/i, /original/i, /exclusive/i, /certified/i,
      ];
      const chipEls = Array.from(document.querySelectorAll('[class*="chip"], [class*="badge"], [class*="tag"], [class*="label"]'));
      const badges = Array.from(new Set(
        chipEls
          .map((el) => str(el.textContent))
          .filter((t) => t && t.length > 2 && t.length < 40 && badgeMatchers.some((re) => re.test(t)))
      )).slice(0, 6);

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
        bookCount,
        supplier,
        badges,
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
  name: 'get-activity',
  aliases: ['detail'],
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

    // 1) Proven language dropdown scraper — always run first
    let languagesFromDropdown: string[] = [];
    try {
      const langResult = await page.evaluate(buildLanguageOptionsJs()) as any;
      if (langResult && Array.isArray(langResult.languages)) {
        languagesFromDropdown = langResult.languages;
      }
    } catch {
      // non-fatal
    }

    // 2) Generic dropdown walker — catches everything else (passenger tier,
    // vehicle type, guide type, etc.). May return nothing if DOM anchors fail,
    // which is fine because language is already captured above.
    let dimensions: { label: string; selected: string; options: string[] }[] = [];
    try {
      const drop = await page.evaluate(buildDropdownOptionsJs()) as any;
      if (drop && Array.isArray(drop.dimensions)) dimensions = drop.dimensions;
    } catch {
      // non-fatal
    }

    const raw = await page.evaluate(buildDetailEvaluate()) as any;
    if (!raw || !raw.title) {
      throw new Error('Could not extract activity detail from GetYourGuide.');
    }

    if (languagesFromDropdown.length > 0) {
      raw.languagesHeader = languagesFromDropdown.join('/');
      // Also add to dimensions if not already present
      if (!dimensions.some((d) => d.options.some((o) => /^(English|Japanese|Chinese|Korean)$/i.test(o)))) {
        dimensions.push({
          label: 'Language',
          selected: languagesFromDropdown[0],
          options: languagesFromDropdown,
        });
      }
    }

    raw.option_dimensions = dimensions;

    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseActivityId };
