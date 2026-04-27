import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs, getCancellationExtractorJs } from '../../shared/section-map.js';

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
      ${getSectionMapJs()}
      ${getCancellationExtractorJs()}

      // Klook is a Vue 2 app — no __NEXT_DATA__. Extract from DOM directly.
      const title = str(document.querySelector('h1')?.textContent);

      // Description from meta tag (cleaner than DOM text)
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      // Rating + reviews + bookings: scan all <span> for patterns.
      // Klook header shows e.g. "4.8/5  29.2K reviews  200K+ booked"
      let starScore = '', reviewCount = '', bookCount = '';
      const spans = Array.from(document.querySelectorAll('span'));
      for (const s of spans) {
        const t = str(s.textContent);
        if (!starScore && /^\\d\\.\\d$/.test(t)) { starScore = t; }
        if (!reviewCount && /[\\d.,]+[KM]?\\s*reviews?/i.test(t) && t.length < 40) { reviewCount = t; }
        if (!bookCount && /[\\d.,]+[KM]?\\+?\\s*booked/i.test(t) && t.length < 40) { bookCount = t; }
      }

      // Language list: Klook renders a joined string like "English/Chinese/Hindi/Japanese/Korean"
      let languagesHeader = '';
      for (const s of spans) {
        const t = str(s.textContent);
        if (!languagesHeader && /^[A-Z][a-z]+(?:\\/[A-Z][a-z]+){1,6}$/.test(t) && t.length < 120) {
          languagesHeader = t;
          break;
        }
      }

      // Tour type + meeting point tags (e.g., "Join in group", "Private tour", "Meet at location", "Hotel pickup")
      let tourTypeTag = '', meetingTag = '';
      for (const s of spans) {
        const t = str(s.textContent);
        if (!tourTypeTag && /^(join in group|private tour|shared group|small group)$/i.test(t)) tourTypeTag = t;
        if (!meetingTag && /^(meet at location|hotel pickup|hotel transfer|pickup included)$/i.test(t)) meetingTag = t;
      }

      // Supplier: Klook renders an explicit "Supplier <name>" line. Be strict —
      // require the candidate to look like a company name (ends in 株式会社, Ltd,
      // LLC, Inc, Co., Tours, Travel, Group) otherwise we'd catch prose like
      // "Provider will notify you...". Match within a sensible window.
      let supplier = '';
      const bodyText = document.body.innerText;
      const supplierRegex =
        /(?:Supplier|Operated by|Provided by)\\s*[:\\-]?\\s*([^\\n]{2,120}?(?:株式会社|有限会社|合同会社|有限公司|株式會社|Ltd\\.?|LLC|Inc\\.?|Co\\.?,?\\s*Ltd\\.?|Corporation|Tours|Travel|Group|GmbH|SA|SAS|Pty\\.?|Pvt\\.?))/i;
      const suppMatch = bodyText.match(supplierRegex);
      if (suppMatch) {
        supplier = suppMatch[1].trim().replace(/^[:\\s\\-]+/, '').slice(0, 120);
      }

      // Badges: Klook renders header "chips" like Klook's choice, Cherry Blossom
      // Guarantee, 2026 Best Things to Do. They live inside the title block —
      // look near the <h1> for <a>/<div> chips with short text.
      const h1 = document.querySelector('h1');
      let badgeSources = [];
      if (h1) {
        // Walk up to the title container and scan its descendants
        let container = h1.parentElement;
        for (let i = 0; i < 3 && container; i++) container = container.parentElement;
        if (container) {
          badgeSources = Array.from(container.querySelectorAll('a, div, span'))
            .map((el) => str(el.textContent))
            .filter((t) => t && t.length > 3 && t.length < 60);
        }
      }
      const badgeMatchers = [
        /klook'?s?\\s*choice/i,
        /best\\s*(?:things|of|sellers?)/i,
        /guarantee/i,
        /best[-\\s]*seller/i,
        /top[-\\s]*rated/i,
        /recommended/i,
        /new/i,
      ];
      const badges = Array.from(new Set(
        badgeSources.filter((t) => badgeMatchers.some((re) => re.test(t)))
      )).slice(0, 6);

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

      // Packages: extract from h3 headings + price spans inside #package_option
      const pkgSection = document.getElementById('package_option');
      const packages = [];
      if (pkgSection) {
        // Package names are h3 inside #package_option (excluding "Package options" header)
        const h3s = Array.from(pkgSection.querySelectorAll('h3'));
        const pkgNames = h3s
          .map((h) => str(h.textContent))
          .filter((t) => t && t !== 'Package options');

        // Find unique price strings
        const priceSpans = pkgSection.querySelectorAll('span');
        const prices = [];
        const priceSet = new Set();
        for (const s of priceSpans) {
          const t = str(s.textContent);
          const match = t.match(/^([A-Z]{2,3}\\$?)\\s*([\\d,.]+)$/);
          if (match && !priceSet.has(t)) {
            priceSet.add(t);
            prices.push({ full: t, currency: match[1].trim() });
          }
        }

        // Find discount tags
        const discountEls = pkgSection.querySelectorAll('[class*="discount"], [class*="off"]');
        const discountTexts = Array.from(discountEls)
          .map((el) => str(el.textContent))
          .filter((t) => /\\d+%/.test(t) && t.length < 20);
        const discount = discountTexts.length > 0 ? discountTexts[0] : '';

        // Create one package per name, with shared price if only one price found
        for (let i = 0; i < pkgNames.length; i++) {
          const price = prices[i] || prices[0] || { full: '', currency: '' };
          packages.push({
            name: pkgNames[i],
            description: '',
            inclusions: [],
            exclusions: [],
            price: price.full,
            currency: price.currency,
            originalPrice: '',
            discount,
            date: '',
            availability: 'Available',
          });
        }
      }

      // Itinerary: extract from .itinerary-day-group.desktop elements
      const itinGroups = document.querySelectorAll('.itinerary-day-group.desktop');
      const itinerary = [];
      const seenTimes = new Set();
      for (const g of itinGroups) {
        const titleEl = g.querySelector('.itinerary-day-group-title');
        const rawTitle = str(titleEl?.textContent);
        const timeMatch = rawTitle.match(/(\\d{1,2}:\\d{2})/);
        const time = timeMatch ? timeMatch[1] : '';
        // Deduplicate by time (multiple packages share same itinerary)
        if (time && seenTimes.has(time)) continue;
        if (time) seenTimes.add(time);
        // Clean title: remove "From" prefix and time
        const title = rawTitle.replace(/^From\\s+/, '').replace(time, '').trim() || rawTitle;
        const descEl = g.querySelector('[class*="content"]');
        const description = str(descEl?.textContent)
          .replace(/See (more|less)/g, '')
          .replace(/Some attractions .*/g, '')
          .trim()
          .slice(0, 500);
        if (time || title) {
          itinerary.push({ time, title, description });
        }
      }

      // Inclusions: from "What's included" klk-collapse-item
      // Klook uses .klk-collapse-item with title text matching "included"
      let inclusions = [], exclusions = [];
      const collapseItems = document.querySelectorAll('.klk-collapse-item');
      for (const item of collapseItems) {
        const titleEl = item.querySelector('.klk-collapse-item-title');
        if (!titleEl || !/included/i.test(titleEl.textContent)) continue;
        const content = item.querySelector('.klk-collapse-item-content-inner') || item;
        const uls = content.querySelectorAll('ul');
        if (uls.length >= 2) {
          inclusions = Array.from(uls[0].querySelectorAll('li')).map((li) => str(li.textContent));
          exclusions = Array.from(uls[1].querySelectorAll('li')).map((li) => str(li.textContent));
        } else if (uls.length === 1) {
          inclusions = Array.from(uls[0].querySelectorAll('li')).map((li) => str(li.textContent));
        }
        break;
      }
      // Attach inclusions/exclusions to all packages
      for (const pkg of packages) {
        pkg.inclusions = inclusions;
        pkg.exclusions = exclusions;
      }

      // ── Sections: capture all named page sections ──
      const sections = [];
      const seenSections = new Set();

      // 1. From klk-collapse-items (expandable sections)
      for (const item of document.querySelectorAll('.klk-collapse-item')) {
        const titleEl = item.querySelector('.klk-collapse-item-title');
        const orig = str(titleEl?.textContent);
        if (!orig || seenSections.has(orig.toLowerCase())) continue;
        seenSections.add(orig.toLowerCase());
        const contentEl = item.querySelector('.klk-collapse-item-content-inner') || item;
        const content = str(contentEl?.textContent)
          .replace(orig, '').replace(/See (more|less)/g, '').trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // 2. From h2 headings not already captured
      for (const h2 of document.querySelectorAll('h2')) {
        const orig = str(h2.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        if (h2.closest('.klk-collapse-item')) continue;
        seenSections.add(orig.toLowerCase());
        const sec = h2.closest('section, [class*="section"]') || h2.parentElement;
        const content = str(sec?.textContent)
          .replace(orig, '').replace(/See (more|less)/g, '').trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // Cancellation policy: derived from the standardized section. Klook
      // typically renders this inside a klk-collapse-item titled "Cancellation
      // policy" — sometimes nested inside "Terms & Conditions". Body-text
      // fallback catches the embedded sub-heading case.
      const cancelSection = sections.find((s) => s.title === 'Cancellation policy');
      let cancellationPolicy = cancelSection ? cancelSection.content : '';
      if (!cancellationPolicy) cancellationPolicy = extractCancellationFromBody(document.body.innerText);

      return {
        title,
        description,
        cityName,
        categoryName,
        starScore,
        reviewCount,
        bookCount,
        badges,
        languagesHeader,
        tourTypeTag,
        meetingTag,
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
  site: 'klook',
  name: 'get-activity',
  aliases: ['detail'],
  description: 'Get full activity payload: title, packages, itinerary, sections, rating, images (Klook)',
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
