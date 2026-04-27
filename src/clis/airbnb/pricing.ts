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
/**
 * Click Airbnb's "Show dates" CTA in the experience booking sidebar to open
 * the time-slot modal. Locale-blind via data-testid (set by Airbnb engineers,
 * not localized): `ExperiencesBookItController-sidebar-button`.
 *
 * Inspected DOM 2026-04-27 (zh-TW + en sessions): the modal that opens is
 * the source of truth — it contains date headings + time-slot cards with
 * inline prices and availability. The deeper calendar grid is a secondary
 * navigation UI we do not need.
 */
const OPEN_BOOKING_MODAL_JS = `
  (async () => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = document.querySelector('[data-testid="ExperiencesBookItController-sidebar-button"]')
      || document.querySelector('[data-testid*="BookItController-sidebar"]')
      || document.querySelector('[data-testid*="show-dates"]');
    if (!btn) return { ok: false, reason: 'no-show-dates-button' };
    // Track dialog set before vs after click — Airbnb pages already have
    // small popovers (cancellation policy etc.) tagged role="dialog", and a
    // naive querySelector after click would grab the wrong one.
    const beforeIds = new Set(
      Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
        .map((d) => d.getAttribute('id') || d.outerHTML.slice(0, 60))
    );
    btn.click();
    await delay(2000);
    const after = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    const opened = after.filter((d) => !beforeIds.has(d.getAttribute('id') || d.outerHTML.slice(0, 60)));
    if (opened.length === 0) {
      return { ok: false, reason: 'no-new-modal-after-click', dialogCountBefore: beforeIds.size, dialogCountAfter: after.length };
    }
    return { ok: true, openedCount: opened.length };
  })()
`;

/**
 * Parse the open booking modal into structured time-slot rows.
 *
 * The modal innerText preserves visual hierarchy via newlines:
 *
 *   Tomorrow, 28 April          ← date heading
 *   12:00 – 2:00 pm             ← time slot
 *   $105 SGD / guest            ← price
 *   1 spot left                 ← availability
 *   3:30 – 5:30 pm              ← next time slot under same date
 *   Sold out                    ← sold-out variant skips price
 *
 * State machine: walk lines, update curDate on heading match, push slot on
 * time-range match, scan next 1-3 lines for price + availability. Locale-aware
 * for date headings (en + CJK numeric "4月28日") and sold-out markers.
 */
const READ_TIME_SLOTS_JS = `
  (() => {
    // Pick the most content-rich dialog — defensive against pre-existing
    // popovers (cancellation, share, etc.) also tagged role="dialog".
    const candidates = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
    if (candidates.length === 0) return { ok: false, reason: 'no-modal' };
    const modal = candidates.reduce((best, c) => {
      const t = (c.innerText || '').length;
      return !best || t > best._textLen ? Object.assign(c, { _textLen: t }) : best;
    }, null);
    if (!modal || !modal._textLen) return { ok: false, reason: 'all-modals-empty', candidateCount: candidates.length };
    const text = modal.innerText || '';
    const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);

    const EN_MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

    const slots = [];
    let curMonth = 0, curDay = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // English date heading — "28 April" / "Tomorrow, 28 April" / "Wednesday, 29 April"
      let m = line.match(/(\\d{1,2})\\s+([A-Za-z]+)/);
      if (m) {
        const idx = EN_MONTHS.indexOf(m[2].toLowerCase());
        if (idx >= 0) {
          curDay = parseInt(m[1], 10);
          curMonth = idx + 1;
          continue;
        }
      }
      // CJK heading — "4月28日" / "4 月 28 日" / "4월 28일"
      m = line.match(/(\\d{1,2})\\s*[月월]\\s*(\\d{1,2})\\s*[日일]/);
      if (m) {
        curMonth = parseInt(m[1], 10);
        curDay = parseInt(m[2], 10);
        continue;
      }

      // Time slot — "12:00 – 2:00 pm" / "3:30 – 5:30 pm" / "9:00 - 11:00"
      const tm = line.match(/(\\d{1,2}:\\d{2})\\s*(?:[ap]m)?\\s*[–\\-—~]\\s*(\\d{1,2}:\\d{2})\\s*([ap]m)?/i);
      if (tm && curMonth && curDay) {
        let price = '', currency = '', priceRaw = '';
        let availability = 'Available';
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const next = lines[j];
          if (/sold\\s*out|售完|滿員|満員|매진|予約不可/i.test(next)) {
            availability = 'Sold out';
          } else if (/spot|位|席|자리/i.test(next) && !/sold/i.test(next)) {
            availability = next;
          }
          // Price line: "$105 SGD" / "US$105" / "¥10,500" / "NT$3,000"
          if (!price) {
            const pm = next.match(/([\\$€£¥]|[A-Z]{2,3}\\$?)\\s*([\\d,]+(?:\\.\\d+)?)\\s*([A-Z]{2,3})?/);
            if (pm) {
              price = pm[2].replace(/,/g, '');
              currency = (pm[3] || pm[1] || '').trim();
              priceRaw = next;
            }
          }
          // Stop scanning if we hit the next time slot line
          if (j > i + 1 && /\\d{1,2}:\\d{2}\\s*[–\\-—~]/.test(next)) break;
        }
        slots.push({
          month: curMonth, day: curDay,
          time: tm[0],
          price, currency, priceRaw,
          availability,
        });
      }
    }
    return { ok: true, slots, lineCount: lines.length, sampleLines: lines.slice(0, 25) };
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

    // Open the booking-modal flow (NOT the calendar — see header comment on
    // OPEN_BOOKING_MODAL_JS for the reasoning).
    const open = await page.evaluate(OPEN_BOOKING_MODAL_JS) as any;
    if (!open?.ok) {
      throw new Error(
        `Could not open Airbnb booking modal: ${open?.reason || 'unknown'}. ` +
        `Page may need login, may be a bot challenge, or Airbnb may have changed the data-testid.`,
      );
    }
    await page.wait(1500);

    const read = await page.evaluate(READ_TIME_SLOTS_JS) as any;
    if (!read?.ok) {
      throw new Error(`Could not read booking modal: ${read?.reason || 'unknown'}`);
    }
    const rawSlots: Array<{
      month: number; day: number; time: string;
      price: string; currency: string; priceRaw: string;
      availability: string;
    }> = read.slots || [];

    // Year inference: airbnb modal omits year. If slot month >= today's month,
    // assume current year; otherwise rolled into next year.
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const inferYear = (m: number) => (m >= curMonth ? curYear : curYear + 1);

    // Group slots by ISO date and pick the cheapest available slot per date.
    // Matches the "1 SKU per date" model: when an experience runs multiple
    // time slots, we report the daily min just like Klook/Trip do for their
    // "From $X" daily price.
    const slotsByDate = new Map<string, typeof rawSlots>();
    for (const s of rawSlots) {
      const iso = `${inferYear(s.month)}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
      if (!slotsByDate.has(iso)) slotsByDate.set(iso, []);
      slotsByDate.get(iso)!.push(s);
    }

    const targets = buildTargetDates(days);
    const checkTimestamp = new Date().toISOString();
    const allRows: any[] = [];
    const errors: { date?: string; reason: string }[] = [];

    for (const t of targets) {
      const daySlots = slotsByDate.get(t.iso) || [];
      if (daySlots.length === 0) {
        errors.push({ date: t.iso, reason: 'date-not-in-modal' });
        continue;
      }
      const priced = daySlots.filter((s) => s.price && s.availability !== 'Sold out');
      if (priced.length === 0) {
        // All slots that day are sold out — record an unavailable row so the
        // ledger has continuity, rather than appearing as missing data.
        allRows.push({
          ota: 'airbnb',
          activity_id: experienceId,
          activity_title: meta.title,
          activity_url: meta.url || url,
          date: t.iso,
          check_date_time_gmt8: checkTimestamp,
          group_title: '',
          package_name: meta.title,
          package_id: experienceId,
          price: '',
          price_raw: daySlots.map((s) => s.time).join('; '),
          package_base_price: '',
          currency: '',
          original_price: '',
          availability: 'Sold out',
          notes_per_person: 'price is per person; all time slots sold out for this date',
        });
        continue;
      }
      priced.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      const cheapest = priced[0];
      allRows.push({
        ota: 'airbnb',
        activity_id: experienceId,
        activity_title: meta.title,
        activity_url: meta.url || url,
        date: t.iso,
        check_date_time_gmt8: checkTimestamp,
        group_title: '',
        package_name: meta.title,
        package_id: experienceId,
        price: cheapest.price,
        price_raw: `${cheapest.time} ${cheapest.priceRaw}`.trim(),
        package_base_price: '',
        currency: cheapest.currency,
        original_price: '',
        availability: cheapest.availability,
        notes_per_person: 'price is per person; cheapest available time slot per date',
      });
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
    // Diagnostic dump: when no rows captured, expose what the modal parser saw
    // so the next debug session doesn't need extra instrumentation.
    if (allRows.length === 0) {
      result._diag = {
        slot_count: rawSlots.length,
        slot_sample: rawSlots.slice(0, 5),
        modal_line_count: read.lineCount,
        modal_sample_lines: read.sampleLines,
      };
    }
    if (errors.length > 0) {
      result.errors = errors;
      result._warning = 'Some captures failed — see errors[]';
    }
    return result;
  },
});
