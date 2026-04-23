/**
 * kkday/pricing — Extract per-package × per-date pricing matrix.
 *
 * KKday inlines per-date prices in the calendar cells once you click "Select"
 * on an option-item. Prices like "from 59.14" are the minimum across sub-SKUs
 * within that package for that date.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseProductId } from './detail.js';

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

/** JS to enumerate option-item elements with their titles and ids. */
const LIST_OPTIONS_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
    return Array.from(document.querySelectorAll('.option-item')).map((item) => {
      const id = item.id || '';
      const h3 = item.querySelector('h3.package-span-list, h3');
      const title = str(h3?.textContent).replace(/Use instantly$/i, '').trim();
      const descEl = item.querySelector('.package-desc');
      const desc = str(descEl?.textContent).slice(0, 400);
      // Group tab this item belongs to (parent group section with data-group-title or similar)
      // KKday splits groups via h2 headings in the option section
      let groupTitle = '';
      let prev = item.previousElementSibling;
      while (prev) {
        const h2 = prev.matches?.('h2') ? prev : prev.querySelector?.('h2');
        if (h2) { groupTitle = str(h2.textContent); break; }
        prev = prev.previousElementSibling;
      }
      // Fallback: look up the tree for a preceding h2
      if (!groupTitle) {
        let p = item.parentElement;
        while (p && !groupTitle) {
          const prevH2 = p.previousElementSibling;
          if (prevH2?.matches?.('h2')) groupTitle = str(prevH2.textContent);
          p = p.parentElement;
        }
      }
      // Price bar hint at top of item
      const priceEl = item.querySelector('.kk-price-local__normal');
      const currEl = item.querySelector('.kk-price-local__currency--symbol');
      const originEl = item.querySelector('.kk-price-base__origin .kk-price-origin__price, .kk-price-origin, del');
      return {
        id,
        title,
        description: desc,
        group_title: groupTitle,
        price_from: str(priceEl?.textContent),
        currency_symbol: str(currEl?.textContent),
        original_price_raw: str(originEl?.textContent),
      };
    });
  })()
`;

/** JS to click the Select button of a specific option-item by id. */
function buildSelectOptionJs(itemId: string): string {
  return `
    (() => {
      const item = document.getElementById(${JSON.stringify(itemId)});
      if (!item) return { ok: false, reason: 'no-item' };
      // Ensure option-head is expanded first (some layouts collapse by default)
      const head = item.querySelector('.option-head');
      if (head && !item.classList.contains('is-expanded')) head.click();
      // Then click Select
      const btn = item.querySelector('.select-option, .kk-button--success');
      if (!btn) return { ok: false, reason: 'no-select-btn' };
      btn.click();
      return { ok: true };
    })()
  `;
}

/**
 * JS to navigate the calendar to a target year/month. KKday calendar shows
 * one month at a time; it has `<` and `>` navigation.
 */
function buildCalNavigateJs(targetYear: number, targetMonth: number): string {
  return `
    (async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const MAX = 18;
      const targetY = ${targetYear};
      const targetM = ${targetMonth};

      for (let step = 0; step < MAX; step++) {
        const cal = document.querySelector('.calendar');
        if (!cal) return { ok: false, reason: 'no-cal' };
        // Header: "April 2026"
        const header = cal.querySelector('[class*="month-name"], [class*="calendar-header"], [class*="header"], .month, thead');
        const label = (header?.textContent || cal.textContent.slice(0, 50)).trim();
        const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let curM = 0, curY = 0;
        for (let i = 0; i < 12; i++) {
          if (label.includes(names[i])) { curM = i + 1; break; }
          if (label.includes(short[i])) { curM = i + 1; break; }
        }
        const yMatch = label.match(/(20\\d{2})/);
        if (yMatch) curY = parseInt(yMatch[1], 10);

        if (curY === targetY && curM === targetM) return { ok: true, steps: step, label };

        // Pick direction
        const curIdx = curY * 12 + curM;
        const tgtIdx = targetY * 12 + targetM;
        const btns = Array.from(cal.querySelectorAll('button, [class*="arrow"], [class*="nav"]'));
        const nextBtn = btns.find(b => {
          const t = (b.textContent || '').trim();
          const cls = (b.className || '').toString();
          return /next|>/.test(cls) || t === '>' || /next/i.test(b.getAttribute?.('aria-label') || '');
        });
        const prevBtn = btns.find(b => {
          const t = (b.textContent || '').trim();
          const cls = (b.className || '').toString();
          return /prev|</.test(cls) || t === '<' || /prev/i.test(b.getAttribute?.('aria-label') || '');
        });
        const btn = tgtIdx > curIdx ? nextBtn : prevBtn;
        if (!btn) return { ok: false, reason: 'no-nav-btn', label };
        btn.click();
        await delay(400);
      }
      return { ok: false, reason: 'max-steps' };
    })()
  `;
}

/** JS to read all selectable date cells in the current calendar view. */
const READ_CAL_CELLS_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim();
    const cal = document.querySelector('.calendar');
    if (!cal) return { ok: false, reason: 'no-cal' };
    // Header month for context
    const label = (cal.textContent || '').slice(0, 60).trim();
    const cells = Array.from(cal.querySelectorAll('td.cell-date'));
    const out = [];
    for (const td of cells) {
      const dayEl = td.querySelector('.date-num');
      const priceEl = td.querySelector('.price');
      const day = parseInt(str(dayEl?.textContent), 10);
      if (!Number.isFinite(day)) continue;
      const priceText = str(priceEl?.textContent);
      // Extract number
      const m = priceText.match(/([\\d,]+(?:\\.\\d+)?)/);
      const priceNum = m ? m[1].replace(/,/g, '') : '';
      const disabled = td.classList.contains('disabled');
      const selectable = td.classList.contains('selectable');
      out.push({ day, price: priceNum, price_raw: priceText, disabled, selectable });
    }
    return { ok: true, label, cells: out };
  })()
`;

cli({
  site: 'kkday',
  name: 'get-pricing-matrix',
  aliases: ['pricing'],
  description: 'Extract per-package × per-date pricing for the next N days',
  domain: 'www.kkday.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or full URL' },
    { name: 'days', type: 'number', default: 7, help: 'Number of days to check starting tomorrow (default 7)' },
  ],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.product || '').trim();
    if (!input) throw new Error('Product ID or URL is required');

    const days = Number(kwargs.days || 7);
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      throw new Error('days must be between 1 and 31');
    }

    const productId = parseProductId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.kkday.com/en/product/${productId}`;

    await page.goto(url);
    await page.wait(6000);
    await page.autoScroll({ times: 5, delayMs: 1500 });
    await page.wait(2000);

    // Page-level info
    const meta = await page.evaluate(`
      (() => ({
        title: (document.querySelector('h1')?.textContent || '').trim(),
        url: location.href,
        currencyHint: (document.querySelector('.kk-price-local__currency--symbol')?.textContent || '').trim(),
      }))()
    `) as any;

    // Enumerate options (packages)
    const options = await page.evaluate(LIST_OPTIONS_JS) as any[];
    if (!Array.isArray(options) || options.length === 0) {
      throw new Error('No option-item elements found on KKday page. Page structure may have changed.');
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
    const errors: { option_id?: string; date?: string; reason: string }[] = [];

    for (const opt of options) {
      // Click Select for this option
      const sel = await page.evaluate(buildSelectOptionJs(opt.id)) as any;
      if (!sel?.ok) {
        errors.push({ option_id: opt.id, reason: `select-click-failed: ${sel?.reason}` });
        continue;
      }
      await page.wait(3000);
      // Calendar is lazy-loaded — scroll to bring it into view
      await page.evaluate(`
        (() => {
          const cal = document.querySelector('.calendar');
          if (cal) { cal.scrollIntoView({ behavior: 'auto', block: 'center' }); return true; }
          // If no calendar yet, scroll the option section into view
          const sec = document.querySelector('#option-sec, #product-option-sec');
          if (sec) { sec.scrollIntoView({ behavior: 'auto', block: 'center' }); return 'scrolled-option-sec'; }
          return false;
        })()
      `);
      await page.wait(2000);
      // Try again in case calendar still not there
      const calCheck = await page.evaluate(`
        (() => ({
          hasCal: !!document.querySelector('.calendar'),
          calHeaderText: (document.querySelector('.calendar')?.textContent || '').slice(0, 80),
        }))()
      `) as any;
      if (!calCheck?.hasCal) {
        // One more scroll+wait attempt
        await page.autoScroll({ times: 2, delayMs: 1000 });
        await page.wait(1500);
      }


      // Iterate target months (usually 1 month, but could cross boundary)
      const capturedDays = new Set<string>();
      for (const [monthKey, monthTargets] of targetsByMonth.entries()) {
        const [y, m] = monthKey.split('-').map(Number);

        const nav = await page.evaluate(buildCalNavigateJs(y, m)) as any;
        if (!nav?.ok) {
          for (const t of monthTargets) {
            errors.push({ option_id: opt.id, date: t.iso, reason: `cal-nav-failed: ${nav?.reason}` });
          }
          continue;
        }
        await page.wait(800);

        const read = await page.evaluate(READ_CAL_CELLS_JS) as any;
        if (!read?.ok) {
          for (const t of monthTargets) {
            errors.push({ option_id: opt.id, date: t.iso, reason: `cal-read-failed: ${read?.reason}` });
          }
          continue;
        }

        // Build day -> cell map
        const cellMap = new Map<number, any>();
        for (const c of read.cells) cellMap.set(c.day, c);

        for (const t of monthTargets) {
          const cell = cellMap.get(t.day);
          if (!cell) {
            errors.push({ option_id: opt.id, date: t.iso, reason: 'day-not-in-cal' });
            continue;
          }
          capturedDays.add(t.iso);
          allRows.push({
            ota: 'kkday',
            activity_id: productId,
            activity_title: meta?.title || '',
            activity_url: meta?.url || url,
            date: t.iso,
            check_date_time_gmt8: checkTimestamp,
            group_title: opt.group_title || '',
            package_name: opt.title,
            package_id: opt.id.replace(/^optionItem/, ''),
            // NOTE: KKday's product-page calendar surfaces the *product-level*
            // minimum per date, not per-package. We therefore report two
            // values: daily_min_price (from the calendar) and package_base_price
            // (from each option's own "from" widget). True per-package×per-date
            // pricing is only visible inside the booking checkout flow.
            daily_min_price: cell.price,
            daily_min_price_raw: cell.price_raw,
            package_base_price: opt.price_from || '',
            currency: (meta?.currencyHint || 'US$').replace('$', '').trim() || 'US',
            original_price: opt.original_price_raw || '',
            availability: cell.selectable ? 'Available' : (cell.disabled ? 'Not available' : 'Unknown'),
          });
        }
      }
    }

    const result: any = {
      activity_id: productId,
      ota: 'kkday',
      url: meta?.url || url,
      title: meta?.title || '',
      days_requested: days,
      days_captured_per_package: Math.max(...[0, ...options.map(o => {
        const got = allRows.filter(r => r.package_id === o.id.replace(/^optionItem/, '')).length;
        return got;
      })]),
      packages_found: options.length,
      _note: 'KKday product-page calendar shows product-level minimum per date. Use daily_min_price for the date surge multiplier and package_base_price for each package base "from" price.',
      rows: allRows,
    };
    if (errors.length > 0) {
      result.errors = errors;
      result._warning = 'Some captures failed — see errors[]';
    }
    return result;
  },
});
