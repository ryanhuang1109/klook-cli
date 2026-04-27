/**
 * trip/pricing — Extract per-SKU × per-date pricing matrix for the next N days.
 *
 * Trip.com shows a 7-day date ceil row with inline "from" prices per date, and
 * a separate SKU/package tab row. Clicking an SKU tab updates the date cell
 * prices to reflect that SKU. Both are `.m_ceil` elements — dates have
 * ID=YYYY-MM-DD, SKUs have numeric IDs.
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

function buildTargetDates(days: number): string[] {
  const today = new Date();
  const out: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(formatDate(d));
  }
  return out;
}

/** Enumerate SKU tabs (the `.m_ceil` elements inside `.sku_tab_ceil` with numeric id). */
const LIST_SKUS_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
    // SKU tabs are .m_ceil children of sku_tab_ceil container
    const container = document.querySelector('[class*="sku_tab_ceil"]');
    if (!container) return [];
    const cells = Array.from(container.querySelectorAll('[class*="m_ceil"][id]')).filter((el) => {
      // Date cells have id like "2026-04-25" — exclude them
      return /^\\d+$/.test(el.id);
    });
    return cells.map((el) => ({
      sku_id: el.id,
      title: str(el.textContent).slice(0, 250),
      testid: el.getAttribute('testid') || '',
    }));
  })()
`;

/** Click a specific SKU tab by id. */
function buildClickSkuJs(skuId: string): string {
  return `
    (() => {
      const el = document.getElementById(${JSON.stringify(skuId)});
      if (!el) return { ok: false, reason: 'no-sku' };
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      el.click();
      return { ok: true };
    })()
  `;
}

/**
 * Read all currently visible date cells — id=YYYY-MM-DD, inline "from" price.
 *
 * Cell DOM has two text spans: date label (e.g. "Sat, Apr 25") and a price span
 * (e.g. "89.8"). We must extract the price from its own element, not the
 * concatenated textContent — otherwise "Sat, Apr 2589.8" gets parsed as 2589.8.
 */
const READ_DATES_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim();
    // Only cells whose id is YYYY-MM-DD
    const all = Array.from(document.querySelectorAll('[class*="m_ceil"][id]'))
      .filter(el => /^20\\d{2}-\\d{2}-\\d{2}$/.test(el.id));
    const seen = new Set();
    const out = [];
    for (const c of all) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const fullText = str(c.textContent);

      // Find the price: it's the SHORTEST leaf text node that looks like a price
      // (e.g. "89.8", "85.18", "80.74", "217.65")
      let price = '';
      const leaves = Array.from(c.querySelectorAll('*')).filter(el => el.children.length === 0);
      // Try leaves last-to-first (price usually rendered after date label)
      for (let i = leaves.length - 1; i >= 0; i--) {
        const t = str(leaves[i].textContent);
        if (/^[\\d,]+(?:\\.\\d+)?$/.test(t) && !/^\\d{1,2}$/.test(t)) {
          // Looks like a price (has decimal or comma), and isn't just a day number
          price = t.replace(/,/g, '');
          break;
        }
      }
      // Fallback: strip date label ("Wed, Apr 22") then extract trailing number
      if (!price) {
        // Date label is everything BEFORE the last number
        const cleaned = fullText.replace(/[A-Za-z]+,?\\s+[A-Za-z]+\\s+\\d+/, '').trim();
        const m = cleaned.match(/([\\d,]+\\.\\d+)/);
        price = m ? m[1].replace(/,/g, '') : '';
      }

      // Availability: cells with "sold out" or "unavailable" class
      const disabled = /disabled|sold_out|unavailable/i.test((c.className || '').toString());

      out.push({
        date: c.id,
        text: fullText,
        price,
        disabled,
      });
    }
    return out;
  })()
`;

/** Also read the currently-shown adult price from the select_quantity_container. */
const READ_CURRENT_PRICE_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim();
    // First adult price block
    const adultBlock = Array.from(document.querySelectorAll('[class*="select_quantity_content"]')).find((el) => /ADULT|Adult/.test(el.textContent || ''));
    let adult = '';
    if (adultBlock) {
      const priceEl = adultBlock.querySelector('[class*="price_price"], [currency]');
      adult = str(priceEl?.textContent);
    }
    const footer = str(document.querySelector('[class*="footer_detail"]')?.textContent);
    return { adult, footer: footer.slice(0, 100) };
  })()
`;

cli({
  site: 'trip',
  name: 'get-pricing-matrix',
  aliases: ['pricing'],
  description: 'Extract per-SKU × per-date pricing for the next N days',
  domain: 'www.trip.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or URL' },
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

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.trip.com/things-to-do/detail/${activityId}/`;

    await page.goto(url);
    await page.wait(6000);
    await page.autoScroll({ times: 6, delayMs: 1500 });
    await page.wait(2500);

    const meta = await page.evaluate(`
      (() => ({
        title: (document.title || '').replace(/\\s*\\|\\s*Trip\\.com.*$/, '').trim(),
        url: location.href,
        currencyHint: (document.querySelector('[class*="calendar_tip"]')?.textContent || '').match(/Currency:\\s*([A-Z]+)/)?.[1] || 'USD',
      }))()
    `) as any;

    // Ensure the SKU section is scrolled into view
    await page.evaluate(`
      (() => {
        const el = document.querySelector('[class*="sku_tab_ceil"], [class*="m_sku_wrapper"]');
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
      })()
    `);
    await page.wait(1500);

    const detectedSkus = await page.evaluate(LIST_SKUS_JS) as any[];
    // Single-package products (e.g. Mt Fuji 105146444, 103219360) don't render
    // the .sku_tab_ceil row at all — there's nothing to switch between. The
    // 7-day price strip is already visible on initial load. Detect that case
    // and synthesize one SKU keyed off the activity itself, mirroring how
    // airbnb/pricing handles its one-package-per-experience model.
    const isSinglePackage = !Array.isArray(detectedSkus) || detectedSkus.length === 0;
    const skus = isSinglePackage
      ? [{ sku_id: activityId, title: meta?.title || 'Standard', testid: '' }]
      : detectedSkus;

    const targetDates = new Set(buildTargetDates(days));
    const checkTimestamp = new Date().toISOString();
    const allRows: any[] = [];
    const errors: { sku_id?: string; date?: string; reason: string }[] = [];

    for (const sku of skus) {
      if (!isSinglePackage) {
        // Click SKU tab to swap the visible price strip into this SKU's row.
        const click = await page.evaluate(buildClickSkuJs(sku.sku_id)) as any;
        if (!click?.ok) {
          errors.push({ sku_id: sku.sku_id, reason: `sku-click-failed: ${click?.reason}` });
          continue;
        }
        await page.wait(2500);
      }

      // Read all visible date cells with their prices
      const dateCells = await page.evaluate(READ_DATES_JS) as any[];
      const dateMap = new Map<string, any>();
      for (const c of dateCells) dateMap.set(c.date, c);

      for (const target of targetDates) {
        const cell = dateMap.get(target);
        if (!cell) {
          errors.push({ sku_id: sku.sku_id, date: target, reason: 'date-not-in-visible-row' });
          continue;
        }
        if (!cell.price) {
          errors.push({ sku_id: sku.sku_id, date: target, reason: 'price-parse-failed' });
          continue;
        }
        allRows.push({
          ota: 'trip',
          activity_id: activityId,
          activity_title: meta?.title || '',
          activity_url: meta?.url || url,
          date: target,
          check_date_time_gmt8: checkTimestamp,
          sku_id: sku.sku_id,
          package_name: sku.title,
          price: cell.price,
          currency: meta?.currencyHint || 'USD',
          price_raw: cell.text,
          availability: 'Available',
        });
      }
    }

    const result: any = {
      activity_id: activityId,
      ota: 'trip',
      url: meta?.url || url,
      title: meta?.title || '',
      days_requested: days,
      days_captured: targetDates.size - (errors.filter(e => e.reason === 'date-not-in-visible-row').length / Math.max(skus.length, 1)),
      skus_found: skus.length,
      single_package: isSinglePackage,
      rows: allRows,
    };
    if (errors.length > 0) {
      result.errors = errors;
      result._warning = 'Some captures failed';
    }
    return result;
  },
});
