/**
 * getyourguide/pricing — Extract per-variant × per-date pricing for the next N days.
 *
 * GYG flow: click "Check availability" to open the datepicker, click each target
 * date, wait for variants/options to appear, scrape price per variant.
 *
 * The datepicker itself embeds a "special price" per day but it's not reliable;
 * the authoritative per-variant price only appears after the date is selected.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityId } from './detail.js';

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildTargetDates(days: number): { iso: string; year: number; monthIdx: number; day: number }[] {
  const today = new Date();
  const out: { iso: string; year: number; monthIdx: number; day: number }[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      iso: formatDate(d),
      year: d.getFullYear(),
      monthIdx: d.getMonth(),  // 0-indexed; matches GYG's #month-YYYY-M id format
      day: d.getDate(),
    });
  }
  return out;
}

/**
 * Open the datepicker. On first entry to the page this is the "Check
 * availability" button. After a date is selected, the UI replaces that with
 * a date input ("Apr 21, 2026" etc.) that re-opens the picker on click.
 */
const OPEN_DATEPICKER_JS = `
  (() => {
    // Short-circuit: picker already visible
    const existing = document.querySelector('.c-datepicker-month-list, [class*="c-datepicker-month"]');
    if (existing) {
      const r = existing.getBoundingClientRect();
      if (r.width > 200 && r.height > 200) return { ok: true, via: 'already-open' };
    }

    // Try in priority order:
    const candidates = [
      // After date selected — GYG shows a chip button with the selected date
      // that re-opens the datepicker dropdown (discovered via probe).
      () => document.querySelector('button.gtm-trigger__adp-date-picker-interaction'),
      () => document.querySelector('[data-test-id="c-datepicker__panel"] button'),
      () => document.querySelector('.c-datepicker-desktop__container button'),
      // Initial page state
      () => document.querySelector('.js-check-availability, button[class*="check-av"]'),
      // "Change date" text
      () => Array.from(document.querySelectorAll('button, [role="button"]')).find(b => /change date|select date/i.test(b.textContent || '')),
      () => Array.from(document.querySelectorAll('button')).find(b => /check availability/i.test(b.textContent || '')),
    ];
    for (const fn of candidates) {
      try {
        const el = fn();
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
          el.click();
          return { ok: true, via: (el.className || '').toString().slice(0, 60) || el.tagName };
        }
      } catch (e) { /* try next */ }
    }
    return { ok: false, reason: 'no-opener' };
  })()
`;

/**
 * Click a specific date cell by its structural position.
 *
 * Locale-blind: navigates to `#month-YYYY-M` (the month section id GYG
 * uses regardless of UI language; verified via probe under zh-TW where
 * everything else was Chinese but the id stayed numeric), then finds the
 * day cell by exact text-content match. Earlier we relied on
 * aria-label = "Wednesday, May 13, 2026" — that string is localised by GYG
 * into the page locale, so under a zh-TW Browser Bridge cookie every date
 * click failed silently.
 */
function buildClickDateJs(year: number, monthIdx: number, day: number): string {
  return `
    (() => {
      const section = document.querySelector('#month-${year}-${monthIdx}');
      if (!section) return { ok: false, reason: 'month-section-missing', want: 'month-${year}-${monthIdx}' };
      const cells = Array.from(section.querySelectorAll('.c-datepicker-day, [class*="c-datepicker-day"]'));
      const cell = cells.find((c) => {
        // Day cell text is just the day number; trim/strip any wrapping spans.
        const txt = (c.textContent || '').trim();
        // Match leading day digits before any space (some templates put "13\\n$372").
        const m = txt.match(/^(\\d{1,2})\\b/);
        return m && parseInt(m[1], 10) === ${day};
      });
      if (!cell) return { ok: false, reason: 'day-cell-not-found', day: ${day} };
      const disabled = cell.getAttribute('aria-disabled') === 'true'
        || /c-datepicker-day--disabled|c-datepicker-day--out-of-range/.test(cell.className);
      if (disabled) return { ok: false, reason: 'disabled', day: ${day} };
      cell.scrollIntoView({ behavior: 'auto', block: 'center' });
      cell.click();
      return { ok: true };
    })()
  `;
}

/**
 * Read variants/options after a date has been selected.
 *
 * GYG's booking flow: after a date click, the booking-assistant-configurator
 * sidebar updates with either (a) a single-variant price or (b) a list of
 * option-cards (for activities with multiple variants — e.g. "with audio guide"
 * vs "with live guide").
 */
const READ_VARIANTS_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');

    // Only treat real option/variant cards — these sit inside the booking
    // assistant and each has a distinct title + price.
    const cards = Array.from(document.querySelectorAll('[data-testid*="option-card"], [class*="option-card"], [class*="variant-card"]'));

    const seen = new Set();
    const out = [];
    for (const card of cards) {
      const text = str(card.textContent).slice(0, 500);
      if (seen.has(text)) continue;
      seen.add(text);
      const titleEl = card.querySelector('h3, h4, [class*="title"], [class*="name"]');
      const priceMatch = text.match(/\\$\\s?([\\d,]+(?:\\.\\d+)?)/);
      const origMatch = (card.querySelector('del, [class*="strikethrough"], [class*="original"]')?.textContent || '')
        .match(/\\$\\s?([\\d,]+(?:\\.\\d+)?)/);
      out.push({
        title: str(titleEl?.textContent).slice(0, 150) || text.slice(0, 150),
        price: priceMatch ? priceMatch[1].replace(/,/g, '') : '',
        original_price: origMatch ? origMatch[1].replace(/,/g, '') : '',
        availability: /sold out|unavailable/i.test(text) ? 'Sold out' : 'Available',
      });
    }

    // Sticky booking bar — captures price when no option cards render
    // (single-variant product, e.g. Tokyo Disneyland 1-Day Passport, OR
    // when GYG renders pricing in a non-USD currency under a localised
    // session like zh-TW which uses "USD373" instead of "$373").
    const bar = document.querySelector('[class*="sticky-booking"], [class*="booking-assistant-configurator"]');
    let barPrice = '', barText = '', barCurrency = '';
    // Helper: try multiple currency formats — ISO prefix ("USD373") and
    // symbol ("$373" / "€100" / "¥10000"). Localised sessions favour the
    // ISO prefix; default en-US uses the glyph.
    const PRICE_RE = /(USD|EUR|GBP|JPY|TWD|HKD|SGD|CNY|KRW|AUD|CAD|\\$|€|£|¥|₩)\\s?([\\d,]+(?:\\.\\d{1,2})?)(?!\\d)/;
    if (bar) {
      barText = str(bar.textContent);
      // Prefer the actual (post-discount) price — GYG renders it in
      // .price-info-actual-price-explanation; .price-info-from-base-price
      // holds the strikethrough original. Fall back to whichever the bar
      // shows when neither subselector is present.
      const actual = bar.querySelector('[class*="actual-price"], [class*="price-info-actual"]');
      const fromBase = bar.querySelector('[class*="from-base-price"], [class*="price-info-from"]');
      const candidates = [actual, fromBase, bar].filter(Boolean);
      for (const node of candidates) {
        const text = str(node.textContent);
        const m = text.match(PRICE_RE);
        if (m) {
          barCurrency = m[1];
          barPrice = m[2].replace(/,/g, '');
          break;
        }
      }
    }

    return { variants: out, barPrice, barCurrency, barText: barText.slice(0, 300) };
  })()
`;

cli({
  site: 'getyourguide',
  name: 'get-pricing-matrix',
  aliases: ['pricing'],
  description: 'Extract per-variant × per-date pricing for the next N days',
  domain: 'www.getyourguide.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or full URL' },
    { name: 'days', type: 'number', default: 7, help: 'Number of days to check starting tomorrow' },
  ],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const days = Number(kwargs.days || 7);
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      throw new Error('days must be between 1 and 31');
    }

    if (!input.startsWith('http')) {
      throw new Error('GetYourGuide requires a full URL (including /city-lXXX/...-tXXX/)');
    }

    const activityId = parseActivityId(input);
    await page.goto(input);
    await page.wait(7000);
    await page.autoScroll({ times: 5, delayMs: 1500 });
    await page.wait(2500);

    const meta = await page.evaluate(`
      (() => ({
        title: (document.querySelector('h1')?.textContent || '').trim(),
        url: location.href,
      }))()
    `) as any;

    const targets = buildTargetDates(days);
    const checkTimestamp = new Date().toISOString();
    const allRows: any[] = [];
    const errors: { date: string; reason: string }[] = [];

    for (const t of targets) {
      // Re-open the datepicker each iteration — GYG closes it after each selection
      const open = await page.evaluate(OPEN_DATEPICKER_JS) as any;
      if (!open?.ok) {
        errors.push({ date: t.iso, reason: `open-datepicker-failed: ${open?.reason}` });
        continue;
      }
      await page.wait(2200);

      const click = await page.evaluate(buildClickDateJs(t.year, t.monthIdx, t.day)) as any;
      if (!click?.ok) {
        errors.push({ date: t.iso, reason: click?.reason || 'click-failed' });
        continue;
      }
      await page.wait(3500);

      const read = await page.evaluate(READ_VARIANTS_JS) as any;
      const variants = Array.isArray(read?.variants) ? read.variants : [];

      if (variants.length === 0) {
        // Single-variant product — fall back to the sticky booking bar's price
        if (read?.barPrice) {
          allRows.push({
            ota: 'getyourguide',
            activity_id: activityId,
            activity_title: meta?.title || '',
            activity_url: meta?.url || input,
            date: t.iso,
            check_date_time_gmt8: checkTimestamp,
            variant_index: 0,
            package_name: meta?.title || '',
            price: read.barPrice,
            // ISO codes pass through unchanged; symbol fallbacks are
            // mapped to USD as a guess. The Browser Bridge cookie pins
            // currency, so this is informational for the analyst.
            currency: read.barCurrency && read.barCurrency.length === 3
              ? read.barCurrency
              : 'USD',
            price_raw: read.barText,
            availability: 'Available',
          });
        } else {
          errors.push({ date: t.iso, reason: `no-variants-and-no-bar-price (barText=${(read?.barText || '').slice(0, 80)})` });
        }
        continue;
      }

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v.price) {
          errors.push({ date: t.iso, reason: `variant-${i}-no-price` });
          continue;
        }
        allRows.push({
          ota: 'getyourguide',
          activity_id: activityId,
          activity_title: meta?.title || '',
          activity_url: meta?.url || input,
          date: t.iso,
          check_date_time_gmt8: checkTimestamp,
          variant_index: i,
          package_name: v.title,
          price: v.price,
          currency: 'USD',
          original_price: v.original_price || '',
          availability: v.availability,
        });
      }
    }

    const result: any = {
      activity_id: activityId,
      ota: 'getyourguide',
      url: meta?.url || input,
      title: meta?.title || '',
      days_requested: days,
      rows: allRows,
    };
    if (errors.length > 0) {
      result.errors = errors;
      result._warning = 'Some captures failed';
    }
    return result;
  },
});
