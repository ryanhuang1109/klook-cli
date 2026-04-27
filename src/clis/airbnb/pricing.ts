/**
 * airbnb/pricing — Extract per-date pricing for an Airbnb Experience.
 *
 * SKU model decision (2026-04-27):
 *   - One SKU per (experience, date). Time-of-day NOT modeled — most experiences
 *     run multiple slots per day at the same per-person price; when they don't,
 *     we report the daily minimum.
 *   - One synthesized package per experience. Private/Group/Language variants
 *     stay in option_dimensions on the detail row, not as separate SKUs.
 *   - Prices are PER-PERSON (Airbnb's native unit). Cross-platform compare must
 *     normalize on the consumer side if a platform is per-group.
 *
 * Currency: cookie-pinned by the Browser Bridge session. See opencli-airbnb
 * skill — switch via airbnb.com footer in a real browser, then sync cookie.
 *
 * v0.1: reads inline calendar prices ("$35 / person" labels on each date cell).
 * Experiences that don't surface inline daily prices return `Unknown` for those
 * dates — clicking each cell to read time-slot prices is doable but click-heavy
 * and risks tripping bot detection. Iterate when we observe real failure rates.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseExperienceId } from './detail.js';

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildTargetDates(days: number): { iso: string; year: number; month: number; day: number }[] {
  const today = new Date();
  const out: { iso: string; year: number; month: number; day: number }[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      iso: formatDate(d),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });
  }
  return out;
}

/**
 * JS to open the Airbnb date picker. Two states:
 *   - Initial render: button labeled "Check availability" or similar
 *   - After first selection: a date input that re-opens the picker on click
 */
const OPEN_PICKER_JS = `
  (async () => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    // Locale-aware: text labels Airbnb uses across en / zh-TW / zh-CN / ja / ko.
    // Anchored to whole-button text so we don't accidentally click an FAQ link.
    const PICKER_LABEL_RE = /^(check availability|select date|add date|choose date|查詢空房|選擇日期|加入日期|選日期|检查可用情况|选择日期|添加日期|空き状況を確認|日付を選択|日付を追加|날짜 선택|예약 가능 여부 확인)$/i;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const picker = buttons.find((b) => {
      const t = (b.textContent || '').trim();
      return PICKER_LABEL_RE.test(t);
    })
      // Structural fallbacks (locale-independent) — testid is developer-set,
      // aria-label may carry the localized "date/日期/日付/날짜" word.
      || document.querySelector('[data-testid*="datepicker"], [data-testid*="calendar"]')
      || document.querySelector('[aria-label*="date" i], [aria-label*="日期"], [aria-label*="日付"], [aria-label*="날짜"]');
    if (!picker) return { ok: false, reason: 'no-picker-trigger' };
    picker.click();
    await delay(800);
    return { ok: true };
  })()
`;

/**
 * JS to navigate the calendar to a target year/month using the > arrow.
 * Airbnb shows two months at a time and uses standard chevron buttons.
 */
function buildCalNavigateJs(targetYear: number, targetMonth: number): string {
  return `
    (async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const MAX = 18;
      const targetY = ${targetYear};
      const targetM = ${targetMonth};
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

      // Parse a month index (1-12) from an arbitrary header string.
      // Handles English long form ("May") and CJK numeric forms ("5月" / "5 月" / "5월").
      // Korean uses 월 (different codepoint from Chinese/Japanese 月) — accept both.
      function parseMonth(txt) {
        for (let i = 0; i < 12; i++) {
          if (txt.includes(monthNames[i])) return i + 1;
        }
        const cjk = txt.match(/(\\d{1,2})\\s*[月월]/);
        if (cjk) {
          const m = parseInt(cjk[1], 10);
          if (m >= 1 && m <= 12) return m;
        }
        return 0;
      }

      for (let step = 0; step < MAX; step++) {
        // Read currently-visible month label(s). Airbnb uses an h2 or similar
        // heading inside the calendar grid.
        const headers = Array.from(document.querySelectorAll(
          '[data-testid*="calendar"] h2, [class*="calendar" i] h2, [class*="month" i]'
        ));
        let curY = 0, curM = 0;
        for (const h of headers) {
          const txt = (h.textContent || '').trim();
          curM = parseMonth(txt);
          const yMatch = txt.match(/(20\\d{2})/);
          if (curM && yMatch) { curY = parseInt(yMatch[1], 10); break; }
        }
        if (!curY || !curM) {
          // Diagnostic dump — first 3 header texts and visible-cell aria-labels
          // so we can see why parseMonth missed (locale variants, structural
          // change, picker not actually open).
          const headerSample = headers.slice(0, 3).map(h => (h.textContent || '').trim().slice(0, 80));
          const cellSample = Array.from(document.querySelectorAll(
            '[role="button"][aria-label*=", "], button[aria-label*=", "], td[role="button"]'
          )).slice(0, 3).map(c => (c.getAttribute('aria-label') || '').slice(0, 80));
          return { ok: false, reason: 'no-month-label', headerCount: headers.length, headerSample, cellSample };
        }
        if (curY === targetY && curM === targetM) return { ok: true, steps: step };
        // Pick navigation button
        const isForward = (targetY * 12 + targetM) > (curY * 12 + curM);
        const navSel = isForward
          ? '[aria-label*="next month" i], [aria-label*="forward" i], button[data-testid*="next"]'
          : '[aria-label*="previous month" i], [aria-label*="back" i], button[data-testid*="prev"]';
        const btn = document.querySelector(navSel);
        if (!btn) return { ok: false, reason: 'no-nav-btn', curY, curM };
        btn.click();
        await delay(500);
      }
      return { ok: false, reason: 'max-steps' };
    })()
  `;
}

/**
 * JS to read all date cells from the visible calendar. Airbnb labels date
 * cells with aria-label like "Saturday, May 2, 2026. Available. Select as
 * check-in date.", and inlines a per-day price under the day number when the
 * experience exposes it.
 */
const READ_CAL_CELLS_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim();
    const cells = Array.from(document.querySelectorAll(
      '[role="button"][aria-label*=", "], button[aria-label*=", "], td[role="button"]'
    ));
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const out = [];
    for (const c of cells) {
      const aria = str(c.getAttribute('aria-label'));
      let year = 0, month = 0, day = 0;
      // English: "Saturday, May 2, 2026"
      let m = aria.match(/^[^,]+,\\s*([A-Z][a-z]+)\\s+(\\d{1,2}),\\s*(20\\d{2})/);
      if (m) {
        const monthIdx = monthNames.indexOf(m[1]);
        if (monthIdx >= 0) { year = parseInt(m[3], 10); month = monthIdx + 1; day = parseInt(m[2], 10); }
      }
      // CJK: "2026年5月2日 星期六" / "2026年5月2日土曜日" / "2026년 5월 2일"
      if (!month) {
        m = aria.match(/(20\\d{2})\\s*[年년]\\s*(\\d{1,2})\\s*[月월]\\s*(\\d{1,2})\\s*[日일]/);
        if (m) { year = parseInt(m[1], 10); month = parseInt(m[2], 10); day = parseInt(m[3], 10); }
      }
      if (!year || !month || !day) continue;
      // Availability: aria sometimes says "Not available" or "Unavailable".
      const unavailable = /not available|unavailable|past date/i.test(aria);
      const disabled = c.hasAttribute('disabled') || c.getAttribute('aria-disabled') === 'true';
      // Inline daily price under the day number, if the experience exposes it.
      const priceEl = c.querySelector('[class*="price" i], [data-testid*="price"]');
      const priceText = str(priceEl?.textContent);
      const priceMatch = priceText.match(/([\\$€£¥]\\s*[\\d,]+(?:\\.\\d+)?)/);
      out.push({
        year, month, day,
        aria,
        price_raw: priceText,
        price: priceMatch ? priceMatch[1] : '',
        unavailable: unavailable || disabled,
      });
    }
    return { ok: true, cells: out };
  })()
`;

cli({
  site: 'airbnb',
  name: 'get-pricing-matrix',
  aliases: ['pricing'],
  description: 'Extract per-date pricing for the next N days (one synthesized package, per-person prices)',
  domain: 'www.airbnb.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'experience', required: true, positional: true, help: 'Experience ID or full URL' },
    { name: 'days', type: 'number', default: 7, help: 'Number of days to check starting tomorrow (default 7, max 31)' },
  ],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.experience || '').trim();
    if (!input) throw new Error('Experience ID or URL is required');

    const days = Number(kwargs.days || 7);
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      throw new Error('days must be between 1 and 31');
    }

    const experienceId = parseExperienceId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.airbnb.com/experiences/${experienceId}`;

    await page.goto(url);
    // Airbnb hydrates lazily; the booking widget needs time to render.
    await page.wait(5000);
    await page.autoScroll({ times: 3, delayMs: 1500 });
    await page.wait(2000);

    // Page meta
    const meta = await page.evaluate(`
      (() => ({
        title: (document.querySelector('h1')?.textContent || '').trim(),
        url: location.href,
      }))()
    `) as any;

    if (!meta?.title) {
      throw new Error(
        'Could not load Airbnb experience page (empty h1). Likely a bot challenge — refresh Browser Bridge cookies via opencli doctor.',
      );
    }

    // Open the date picker
    const open = await page.evaluate(OPEN_PICKER_JS) as any;
    if (!open?.ok) {
      // Some experience pages already render an inline calendar in the booking
      // sidebar without needing a click — try to read straight away.
    } else {
      await page.wait(1500);
    }

    const targets = buildTargetDates(days);
    const targetsByMonth = new Map<string, typeof targets>();
    for (const t of targets) {
      const key = `${t.year}-${t.month}`;
      if (!targetsByMonth.has(key)) targetsByMonth.set(key, []);
      targetsByMonth.get(key)!.push(t);
    }

    const checkTimestamp = new Date().toISOString();
    const allRows: any[] = [];
    const errors: { date?: string; reason: string }[] = [];

    for (const [monthKey, monthTargets] of targetsByMonth.entries()) {
      const [y, m] = monthKey.split('-').map(Number);

      const nav = await page.evaluate(buildCalNavigateJs(y, m)) as any;
      if (!nav?.ok) {
        const diag = nav?.headerSample || nav?.cellSample
          ? ` headers=${JSON.stringify(nav.headerSample || []).slice(0, 200)} cells=${JSON.stringify(nav.cellSample || []).slice(0, 200)}`
          : '';
        for (const t of monthTargets) {
          errors.push({ date: t.iso, reason: `cal-nav-failed: ${nav?.reason}${diag}` });
        }
        continue;
      }
      await page.wait(700);

      const read = await page.evaluate(READ_CAL_CELLS_JS) as any;
      if (!read?.ok || !Array.isArray(read.cells) || read.cells.length === 0) {
        for (const t of monthTargets) {
          errors.push({ date: t.iso, reason: `cal-read-failed: ${read?.reason || 'no-cells'}` });
        }
        continue;
      }

      // Build (year-month-day) → cell map
      const cellMap = new Map<string, any>();
      for (const c of read.cells) {
        cellMap.set(`${c.year}-${c.month}-${c.day}`, c);
      }

      for (const t of monthTargets) {
        const cell = cellMap.get(`${t.year}-${t.month}-${t.day}`);
        if (!cell) {
          errors.push({ date: t.iso, reason: 'day-not-in-cal' });
          continue;
        }
        // Extract numeric price (no currency symbol) for downstream normalization.
        const numericMatch = cell.price.match(/([\d,]+(?:\.\d+)?)/);
        const numeric = numericMatch ? numericMatch[1].replace(/,/g, '') : '';
        allRows.push({
          ota: 'airbnb',
          activity_id: experienceId,
          activity_title: meta.title,
          activity_url: meta.url || url,
          date: t.iso,
          check_date_time_gmt8: checkTimestamp,
          group_title: '',
          // One synthesized package per experience — see SKU model decision in
          // file header comment.
          package_name: meta.title,
          package_id: experienceId,
          // Use the shared PricingRowRaw contract field names (`price` /
          // `price_raw`) so src/tours/normalize.ts picks these up without
          // platform-specific branching. Airbnb's "per-person daily min"
          // semantic note lives in the run-level `_note`, not the field name.
          price: numeric,
          price_raw: cell.price_raw,
          package_base_price: '',
          // Currency is whatever the Browser Bridge cookie pinned. We extract
          // the symbol ($, €, ¥, £) from the price string and pass it through;
          // the normalizer maps it to ISO.
          currency: cell.price.match(/[\$€£¥]/)?.[0] || '',
          original_price: '',
          availability: cell.unavailable ? 'Not available' : (cell.price ? 'Available' : 'Unknown'),
          notes_per_person: 'price is per person',
        });
      }
    }

    const result: any = {
      activity_id: experienceId,
      ota: 'airbnb',
      url: meta.url || url,
      title: meta.title,
      days_requested: days,
      days_captured: allRows.filter(r => r.price).length,
      packages_found: 1,
      _note:
        'Airbnb experiences are priced per-person. One synthesized package per experience; ' +
        'time-of-day NOT modeled — `price` is the lowest visible price across slots that day. ' +
        'Empty price means the experience does not surface inline daily prices on the calendar; ' +
        'click-through fallback not yet implemented.',
      rows: allRows,
    };
    if (errors.length > 0) {
      result.errors = errors;
      result._warning = 'Some captures failed — see errors[]';
    }
    return result;
  },
});
