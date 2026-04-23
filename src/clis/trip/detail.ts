/**
 * trip/detail — Show Trip.com activity detail with package pricing.
 *
 * Navigates to the activity page, optionally selects a date range,
 * and extracts title, description, rating, images, and package pricing.
 * Uses Browser Bridge (COOKIE strategy) since Trip.com is SSR.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs } from '../../shared/section-map.js';

export function parseActivityId(input: string): string {
  const urlMatch = input.match(/\/detail\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input;
}

export function buildDetailEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      ${getSectionMapJs()}

      // Title: Trip.com uses div[class*=title_foot_warp_left] instead of h1
      // Fall back to document.title with Trip.com suffix stripped
      let title = str(
        document.querySelector('[class*="title_foot_warp_left"]')?.textContent
        || document.querySelector('h1')?.textContent
        || document.title?.replace(/\\s*\\|\\s*Trip\\.com.*$/, '')
      );
      // Clean: title div may contain promotion text appended after the real title
      const promoIdx = title.indexOf('Promotion');
      if (promoIdx > 10) title = title.slice(0, promoIdx).trim();
      const durationIdx = title.indexOf('Duration:');
      if (durationIdx > 10) title = title.slice(0, durationIdx).trim();

      // Description from meta
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      // Rating + reviews: scan page text for patterns like "4.8/5" and "(419 reviews)"
      let starScore = '', reviewCount = '', bookCount = '';
      const bodyText = document.body.innerText;
      const ratingMatch = bodyText.match(/(\\d\\.\\d)\\/5/);
      if (ratingMatch) starScore = ratingMatch[1];
      const reviewMatch = bodyText.match(/\\(?(\\d[\\d,]*[KM]?\\s*reviews?)\\)?/i);
      if (reviewMatch) reviewCount = reviewMatch[1];
      // Trip.com surfaces bookings as e.g. "10K+ booked" or "1,234 orders"
      const bookMatch = bodyText.match(/([\\d,.]+[KM]?\\+?\\s*(?:booked|orders|sold))/i);
      if (bookMatch) bookCount = bookMatch[1];

      // Supplier — require a company-name suffix to avoid catching prose text
      let supplier = '';
      const supplierRegex =
        /(?:Operated by|Supplier|Provided by)\\s*[:\\-]?\\s*([^\\n]{2,120}?(?:株式会社|有限会社|合同会社|有限公司|株式會社|Ltd\\.?|LLC|Inc\\.?|Co\\.?,?\\s*Ltd\\.?|Corporation|Tours|Travel|Group|GmbH|SA|SAS|Pty\\.?|Pvt\\.?))/i;
      const supMatch = bodyText.match(supplierRegex);
      if (supMatch) {
        supplier = supMatch[1].trim().replace(/^[:\\s\\-]+/, '').slice(0, 120);
      }

      // Images from CDN
      const seenImgs = new Set();
      const images = Array.from(document.querySelectorAll('img[src*="tripcdn"], img[src*="trip.com"]'))
        .map((img) => img.src)
        .filter((src) => src.includes('/images/') && !seenImgs.has(src) && (seenImgs.add(src), true))
        .slice(0, 10);

      // Available dates from date selector
      const dateCells = document.querySelectorAll('[class*="date_ceil_wrapper"]');
      const availableDates = Array.from(dateCells)
        .map((el) => str(el.textContent))
        .filter(Boolean);

      // ── Sections: capture all named h2/h3 sections ──
      const sections = [];
      const seenSections = new Set();
      const allHeadings = Array.from(document.querySelectorAll('h2, h3'));

      for (const h of allHeadings) {
        const orig = str(h.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        seenSections.add(orig.toLowerCase());
        const sec = h.closest('section, [class*="section"], [class*="module"]') || h.parentElement;
        const content = str(sec?.textContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // ── Inclusions / Exclusions ──
      let inclusions = [], exclusions = [];
      const inclH = allHeadings.find(h => /included|includes/i.test(str(h.textContent)));
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
        const exclH = allHeadings.find(h => /not included|excludes|excluded/i.test(str(h.textContent)));
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
      const pkgEls = document.querySelectorAll('[class*="package_item_new"]');
      const packages = Array.from(pkgEls).map((el) => {
        const text = str(el.textContent);
        // Name: everything before "From" or price pattern
        const nameMatch = text.match(/^(.+?)(?:From|US\\$|HK\\$|TWD|EUR|JPY|SGD|KRW)/);
        const name = nameMatch ? str(nameMatch[1]) : text.slice(0, 120);
        // Price
        const priceMatch = text.match(/((?:US|HK|TWD|EUR|JPY|SGD|KRW)\\$?\\s*[\\d,.]+)/);
        const price = priceMatch ? priceMatch[1] : '';
        // Original price (strikethrough)
        const delEl = el.querySelector('del, [class*="line-through"], [class*="original"], [class*="market"]');
        const originalPrice = delEl ? str(delEl.textContent) : '';
        // Discount
        const discountEl = el.querySelector('[class*="discount"], [class*="off"], [class*="save"]');
        const discount = discountEl ? str(discountEl.textContent) : '';
        // Availability
        const soldOut = /sold out|unavailable/i.test(text);
        // Package description: collect bullet points or short description near package
        const descEl = el.querySelector('[class*="desc"], [class*="info"], [class*="detail"]');
        const pkgDesc = descEl ? str(descEl.textContent).slice(0, 500) : '';

        return {
          name,
          description: pkgDesc,
          inclusions,
          exclusions,
          price,
          currency: price.match(/^[A-Z]+\\$?/)?.[0] || '',
          originalPrice,
          discount,
          date: availableDates[0] || '',
          availability: soldOut ? 'Sold out' : 'Available',
        };
      });

      return {
        title,
        description,
        cityName: '',
        categoryName: '',
        starScore,
        reviewCount,
        bookCount,
        supplier,
        images,
        itinerary,
        packages,
        sections,
        url: location.href,
      };
    })()
  `;
}

/** Build JS to click a specific date in the date selector and wait for price update. */
export function buildDateClickEvaluate(targetDate: string): string {
  return `
    (async () => {
      const target = ${JSON.stringify(targetDate)};
      const dateCells = document.querySelectorAll('[class*="date_ceil_wrapper"]');
      for (const cell of dateCells) {
        const text = (cell.textContent || '').trim();
        if (text.includes(target)) {
          cell.click();
          return true;
        }
      }
      // If target not in visible dates, try clicking a "more dates" button or calendar
      const moreBtn = document.querySelector('[class*="calendar_more"], [class*="see_more_date"], [class*="date_picker"]');
      if (moreBtn) moreBtn.click();
      return false;
    })()
  `;
}

/**
 * Collect pricing across multiple dates by clicking each date tab.
 * Returns an array of { date, packages[] } for each available date.
 */
export function buildMultiDateEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      const getPrices = () => {
        const items = document.querySelectorAll('[class*="package_item_new"]');
        return Array.from(items).map((el) => {
          const text = str(el.textContent);
          const nameMatch = text.match(/^(.+?)(?:From|US\\$|HK\\$|TWD|EUR|JPY|SGD|KRW)/);
          const name = nameMatch ? str(nameMatch[1]) : text.slice(0, 120);
          const priceMatch = text.match(/((?:US|HK|TWD|EUR|JPY|SGD|KRW)\\$?\\s*[\\d,.]+)/);
          const price = priceMatch ? priceMatch[1] : '';
          const soldOut = /sold out|unavailable/i.test(text);
          return { name, price, availability: soldOut ? 'Sold out' : 'Available' };
        });
      };

      const dateCells = Array.from(document.querySelectorAll('[class*="date_ceil_wrapper"]'));
      const results = [];

      for (const cell of dateCells) {
        const dateText = str(cell.textContent);
        if (!dateText || dateText === 'All') continue;
        cell.click();
        await delay(1500);
        const packages = getPrices();
        results.push({ date: dateText, packages });
      }

      return results;
    })()
  `;
}

cli({
  site: 'trip',
  name: 'get-activity',
  aliases: ['detail'],
  description: 'Show Trip.com activity detail with package pricing across dates',
  domain: 'www.trip.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or URL (e.g. "92795279")' },
    { name: 'date', help: 'Specific date (YYYY-MM-DD) to check pricing' },
    { name: 'compare-dates', type: 'boolean', help: 'Compare pricing across all visible dates' },
  ],
  columns: ['title', 'rating', 'review_count'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.trip.com/things-to-do/detail/${activityId}/`;

    // If specific date requested, add date param to URL
    let targetUrl = url;
    if (kwargs.date) {
      const dateStr = String(kwargs.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error('date must be in YYYY-MM-DD format');
      }
      targetUrl = url.includes('?')
        ? `${url}&date=${dateStr}`
        : `${url}?date=${dateStr}`;
    }

    await page.goto(targetUrl);
    // Trip.com is a heavy React app that lazy-loads the SKU section on
    // scroll. Give the page a beat to hydrate before scrolling, then wait
    // again after scroll — skipping either causes intermittent "target
    // navigated or closed" errors during the subsequent DOM reads.
    await page.wait(6000);
    await page.autoScroll({ times: 3, delayMs: 1500 });
    await page.wait(2000);

    // If compare-dates flag is set, collect pricing across all visible dates
    if (kwargs['compare-dates']) {
      const raw = await page.evaluate(buildDetailEvaluate());
      const detail = parseActivityDetail(raw || {});

      const datePricing = await page.evaluate(buildMultiDateEvaluate());
      const pricingByDate = Array.isArray(datePricing) ? datePricing : [];

      return {
        ...detail,
        pricing_by_date: pricingByDate,
      };
    }

    // Read Trip.com's SKU-tab cluster PASSIVELY — just grab the text labels,
    // no clicks. Earlier we had a generic dropdown walker here that clicked
    // every `[class*="selector"]` element; on Trip that matched the date
    // cells (also `.m_ceil`), and each click fired an AJAX price refresh
    // that frequently broke the browser-bridge session with
    // `Inspected target navigated or closed`. Passive read is enough — the
    // SKU tabs already give us the main package-variant axis.
    const dimensions = await page.evaluate(`
      (() => {
        const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
        const dims = [];
        const skuContainer = document.querySelector('[class*="sku_tab_ceil"]');
        if (skuContainer) {
          const tabs = Array.from(skuContainer.querySelectorAll('[class*="m_ceil"][id]'))
            .filter((el) => /^\\d+$/.test(el.id));
          const opts = Array.from(new Set(
            tabs.map((el) => str(el.textContent).slice(0, 120))
          )).filter(Boolean);
          if (opts.length >= 1) {
            dims.push({ label: 'Package', selected: opts[0] ?? '', options: opts });
          }
        }
        return { dimensions: dims };
      })()
    `) as any;

    // Standard detail extraction
    const raw = await page.evaluate(buildDetailEvaluate()) as any;
    if (!raw || !raw.title) {
      throw new Error('Could not extract activity detail from Trip.com.');
    }

    if (dimensions && Array.isArray(dimensions.dimensions)) {
      raw.option_dimensions = dimensions.dimensions;
    }

    return parseActivityDetail(raw);
  },
});

export const __test__ = { parseActivityId };
