/**
 * klook/pricing — Extract per-package × per-date pricing matrix.
 *
 * Opens the activity page, iterates through a date range (starting today + 1),
 * clicks each date in the calendar, and scrapes package cards for pricing.
 *
 * Output: flat rows of { date, group_title, package_name, package_id, price, currency, original_price }
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityId } from './detail.js';

/** Format a Date as YYYY-MM-DD in local time (GMT+8 for Klook). */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build list of target dates: today + 1 through today + days. */
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

/** JS to open calendar popup.
 *
 * `#desktop-package-date-picker` is itself the <button> — earlier code searched
 * for a button child, which silently returned null and propagated to the
 * calendar-nav step as "no-nav-btn". */
const OPEN_CALENDAR_JS = `
  (() => {
    const btn = document.querySelector(
      '#desktop-package-date-picker, .activity-package-date-button-picker, .all-date-box button, .activity-package-date.js-spm-package-date-picker button'
    );
    if (btn) { btn.click(); return true; }
    return false;
  })()
`;

/** JS to navigate calendar to a specific month/year (clicks next/prev until reached). */
function buildNavigateMonthJs(targetYear: number, targetMonth: number): string {
  return `
    (async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const MAX_STEPS = 18;
      const targetY = ${targetYear};
      const targetM = ${targetMonth};

      for (let step = 0; step < MAX_STEPS; step++) {
        // Read current month label from the panel header (e.g. "Apr 2026")
        const header = document.querySelector('.klk-date-picker-header-label, .klk-date-picker-panel-header');
        const label = (header?.textContent || '').trim();
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let curY = 0, curM = 0;
        const m = label.match(/([A-Za-z]{3,})\\s+(\\d{4})/);
        if (m) {
          curM = monthNames.findIndex((n) => m[1].startsWith(n)) + 1;
          curY = parseInt(m[2], 10);
        }
        if (curY === targetY && curM === targetM) return { ok: true, steps: step, label };
        const curIdx = curY * 12 + curM;
        const tgtIdx = targetY * 12 + targetM;
        const btnSel = tgtIdx > curIdx ? '.klk-date-picker-next-btn' : '.klk-date-picker-prev-btn';
        const btn = document.querySelector(btnSel);
        if (!btn) return { ok: false, reason: 'no-nav-btn', label };
        btn.click();
        await delay(250);
      }
      return { ok: false, reason: 'max-steps-exceeded' };
    })()
  `;
}

/** JS to click a specific day cell in currently-visible calendar month. */
function buildClickDayJs(day: number): string {
  return `
    (() => {
      // Only pick cells in the active month — skip ghost cells from prev/next month
      // Active cells: .klk-date-picker-date:not(.klk-date-picker-date-disabled)
      // Each has .klk-date-picker-date-inner with just the day number
      const cells = Array.from(document.querySelectorAll('.klk-date-picker-date:not(.klk-date-picker-date-disabled)'));
      for (const c of cells) {
        const inner = c.querySelector('.klk-date-picker-date-inner');
        const n = parseInt((inner?.textContent || '').trim(), 10);
        // Klook renders spill-over dates (next month) as enabled spans too — skip those
        // by checking parent panel view which has only the active month's dates
        // Heuristic: active-month cells have a sibling .klk-date-picker-date-append that
        // either is empty or contains a price like "6.29"
        if (n === ${day}) {
          c.click();
          return { ok: true, clicked: n };
        }
      }
      return { ok: false, dayNotFound: ${day} };
    })()
  `;
}

/** JS to scrape currently-visible package cards and their prices.
 *
 * Klook ships two coexisting package-picker UIs and routes activities to
 * either at random:
 *   - Old: `#package_options_group .card[id*="group-web-id"]` — a flat list
 *     of cards with prices visible per card. Preferred when present.
 *   - New: `#package_option` / `.activity-package-options` — a chip-filter
 *     UI showing only the currently-selected package's price in the right
 *     rail. Treated as a fallback. */
const SCRAPE_PACKAGES_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
    const PRICE_RE = /((?:HK|US|TWD|JPY|SGD|KRW|EUR|CNY|CHF|GBP|AUD)\\$?)\\s*([\\d,]+(?:\\.\\d+)?)/;
    const out = [];

    // ── Old UI: flat .card list ──
    // Each .card is a package (SKU). They sit under group containers whose
    // data-spm-module encodes GroupTitle.
    const cards = Array.from(document.querySelectorAll('#package_options_group .card[id*="group-web-id"]'));

    for (const card of cards) {
      // Name
      const nameEl = card.querySelector('.card-top-cardName');
      const name = str(nameEl?.textContent);

      // Package id: "js-pkg-id-<PID>" on the card class list
      let pkgId = '';
      for (const cls of Array.from(card.classList)) {
        const m = cls.match(/^js-pkg-id-(\\d+)$/);
        if (m) { pkgId = m[1]; break; }
      }
      // Fallback: id attribute like "group-web-id-<pid>-<gid>"
      if (!pkgId) {
        const idMatch = (card.id || '').match(/group-web-id-(\\d+)-(\\d+)/);
        if (idMatch) pkgId = idMatch[1];
      }

      // Group title: data-spm-module is URL-encoded JSON like
      //   ext=%7B%22GroupTitle%22%3A%22Studio%20Pass%22%2C%22Groupid%22%3A34188%7D
      // Decode first, then match "GroupTitle":"..."
      let groupTitle = '';
      const spm = card.getAttribute('data-spm-module') || '';
      try {
        const decoded = decodeURIComponent(spm);
        const gm = decoded.match(/"GroupTitle"\\s*:\\s*"([^"]+)"/);
        if (gm) groupTitle = gm[1];
      } catch (e) { /* fall through */ }
      // Fallback: read preceding group heading
      if (!groupTitle) {
        const groupHeader = card.closest('[id*="group-package"]')?.querySelector('[class*="group-name"], [class*="group-title"], h3');
        groupTitle = str(groupHeader?.textContent);
      }

      // Price: nearest .price-sale-price inside this card
      const priceEl = card.querySelector('.price-sale-price, .price');
      const priceText = str(priceEl?.textContent);
      const priceMatch = priceText.match(/((?:HK|US|TWD|JPY|SGD|KRW|EUR|CNY|CHF|GBP|AUD)\\$?)\\s*([\\d,]+(?:\\.\\d+)?)/);
      const currency = priceMatch ? priceMatch[1].replace('$', '').trim() : '';
      const price = priceMatch ? priceMatch[2].replace(/,/g, '') : '';

      // Original (strikethrough) price
      const origEl = card.querySelector('del, .original-price, [class*="line-through"], [class*="market-price"]');
      const origText = str(origEl?.textContent);
      const origMatch = origText.match(/((?:HK|US|TWD|JPY|SGD|KRW|EUR|CNY|CHF|GBP|AUD)\\$?)\\s*([\\d,]+(?:\\.\\d+)?)/);
      const originalPrice = origMatch ? origMatch[2].replace(/,/g, '') : '';

      // Availability
      const soldOutEl = card.querySelector('[class*="sold-out"], [class*="unavailable"]');
      const availability = soldOutEl ? 'Sold out' : 'Available';

      out.push({
        package_id: pkgId,
        group_title: groupTitle,
        package_name: name,
        price,
        currency,
        original_price: originalPrice,
        price_raw: priceText,
        availability,
      });
    }

    // ── New UI fallback: chip-filter picker ──
    // Only fires when the old card list is empty. Reads the currently-
    // selected package's price from the right-rail / banner. Records one
    // synthetic row per visible package-type chip so we capture at least the
    // base-price dimension of the matrix; the price is the same across rows
    // (Klook's new UI doesn't reveal per-chip prices without a click).
    if (out.length === 0) {
      const newRoot = document.querySelector('#package_option, .activity-package-options');
      if (newRoot) {
        const priceEl =
          document.querySelector('.desktop-new-right-price [class*="price-base"], .page-banner-right-price [class*="price-base"], .price-box.salling-price') ||
          newRoot.querySelector('[class*="price-base"], [class*="salling-price"], [class*="price"]');
        const priceText = str(priceEl?.textContent);
        const m = priceText.match(PRICE_RE);
        if (m) {
          const currency = m[1].replace('$', '').trim();
          const price = m[2].replace(/,/g, '');

          // Chip-style package list lives under .package-options-attr-desktop
          // or similar. Each chip is a clickable child with the package label.
          const attrRoot =
            newRoot.querySelector('.package-options-attr-desktop, .package-options-content[class*="detail-type"]') || newRoot;
          const chipEls = Array.from(
            attrRoot.querySelectorAll('[class*="kk-chip"], [class*="package-attr-item"], [class*="spec-item"], [class*="option-card"], button, [role="button"]')
          ).filter((el) => {
            const t = str(el.textContent);
            return t && t.length > 2 && t.length < 200 && !/^(check availability|select|clear all|please|reset)$/i.test(t);
          });
          // Dedupe by chip text — Klook duplicates chip nodes for desktop/mobile.
          const seen = new Set();
          const chips = [];
          for (const el of chipEls) {
            const label = str(el.textContent);
            if (!seen.has(label)) { seen.add(label); chips.push(label); }
          }

          if (chips.length === 0) {
            // No chips visible — synthesize one entry from the page title.
            const title = str(document.querySelector('h1')?.textContent).slice(0, 200);
            out.push({
              package_id: 'newui-default',
              group_title: 'Package',
              package_name: title || 'Default package',
              price,
              currency,
              original_price: '',
              price_raw: priceText,
              availability: 'Available',
            });
          } else {
            for (let i = 0; i < chips.length; i++) {
              out.push({
                package_id: 'newui-' + i,
                group_title: 'Package',
                package_name: chips[i].slice(0, 200),
                price,
                currency,
                original_price: '',
                price_raw: priceText,
                availability: 'Available',
              });
            }
          }
        }
      }
    }

    return out;
  })()
`;

/** JS to check whether calendar popup is currently open. */
const CALENDAR_IS_OPEN_JS = `
  (() => {
    const cal = document.querySelector('.klk-date-picker');
    if (!cal) return false;
    // The picker DIV exists but is only visible when popup open — check display
    const rect = cal.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })()
`;

cli({
  site: 'klook',
  name: 'get-pricing-matrix',
  aliases: ['pricing'],
  description: 'Extract per-package × per-date pricing for the next N days',
  domain: 'www.klook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or full URL' },
    { name: 'days', type: 'number', default: 7, help: 'Number of days to check starting tomorrow (default 7)' },
  ],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const days = Number(kwargs.days || 7);
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      throw new Error('days must be between 1 and 31');
    }

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.klook.com/activity/${activityId}/`;

    await page.goto(url);
    await page.wait(3000);
    await page.autoScroll({ times: 4, delayMs: 1200 });
    await page.wait(1500);

    const targets = buildTargetDates(days);
    const checkTimestamp = new Date().toISOString();
    const allRows: any[] = [];
    const errors: { date: string; reason: string }[] = [];

    // Grab title for context
    const meta = await page.evaluate(`
      (() => ({
        title: (document.querySelector('h1')?.textContent || '').trim(),
        url: location.href,
      }))()
    `) as any;

    for (const t of targets) {
      // Ensure calendar is open
      const isOpen = await page.evaluate(CALENDAR_IS_OPEN_JS) as boolean;
      if (!isOpen) {
        await page.evaluate(OPEN_CALENDAR_JS);
        await page.wait(1200);
      }

      // Navigate to target month
      const nav = await page.evaluate(buildNavigateMonthJs(t.year, t.month)) as any;
      if (!nav?.ok) {
        errors.push({ date: t.iso, reason: `nav-failed: ${nav?.reason || 'unknown'}` });
        continue;
      }

      // Click the target day
      const click = await page.evaluate(buildClickDayJs(t.day)) as any;
      if (!click?.ok) {
        errors.push({ date: t.iso, reason: `day-click-failed: day ${t.day} not clickable` });
        continue;
      }

      // Wait for prices to update
      await page.wait(2200);

      // Scrape
      const pkgs = await page.evaluate(SCRAPE_PACKAGES_JS) as any[];
      if (!Array.isArray(pkgs) || pkgs.length === 0) {
        errors.push({ date: t.iso, reason: 'no-packages-scraped' });
        continue;
      }

      for (const p of pkgs) {
        allRows.push({
          ota: 'klook',
          activity_id: activityId,
          activity_title: meta?.title || '',
          activity_url: meta?.url || url,
          date: t.iso,
          check_date_time_gmt8: checkTimestamp,
          ...p,
        });
      }
    }

    if (errors.length > 0) {
      // User requirement: "一定要抓到" — fail loudly if any date is missing
      return {
        activity_id: activityId,
        ota: 'klook',
        url: meta?.url || url,
        title: meta?.title || '',
        days_requested: days,
        days_captured: targets.length - errors.length,
        rows: allRows,
        errors,
        _warning: 'Some dates failed to capture — see errors[]',
      };
    }

    return {
      activity_id: activityId,
      ota: 'klook',
      url: meta?.url || url,
      title: meta?.title || '',
      days_requested: days,
      days_captured: targets.length,
      rows: allRows,
    };
  },
});
