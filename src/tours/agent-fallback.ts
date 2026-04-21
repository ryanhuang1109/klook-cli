/**
 * LLM-powered extraction fallback ("agent-browser lite").
 *
 * When opencli's DOM-selector path returns 0 packages, we re-open the page
 * through the browser bridge, pull the visible text + package-like blocks,
 * and ask an LLM to extract the package list as JSON. This recovers cases
 * where the site uses a DOM structure our selectors don't match (different
 * product types, redesigns, experimental rollouts).
 *
 * Not a full multi-turn agent yet — one-shot structured extraction is enough
 * to handle ~80% of "0 packages" failures. Upgrade to tool-calling loop later
 * when we need to click through dropdowns / calendars.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chatJSON } from './llm.js';
import type { PricingRowRaw } from './types.js';

interface AgentExtractResult {
  packages: Array<{
    name: string;
    price: string;
    currency: string;
    availability: string;
    language_hint?: string;
    group_size_hint?: string;
  }>;
  supplier: string;
  languages: string[];
  order_count: string;
  extraction_notes: string;
}

async function getBrowserBridge(): Promise<any> {
  try {
    // @ts-ignore — non-public but present at runtime
    const mod = await import('@jackwener/opencli/browser');
    return mod.BrowserBridge;
  } catch {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const opencliPath = require.resolve('@jackwener/opencli');
    const { dirname, join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const browserPath = join(dirname(opencliPath), 'browser', 'index.js');
    const mod = await import(pathToFileURL(browserPath).href);
    return mod.BrowserBridge;
  }
}

/**
 * Re-render the page through browser bridge and pull visible structured
 * chunks that are likely to contain package info. We trim aggressively so
 * the LLM prompt stays under a few thousand tokens.
 */
async function capturePageSnapshot(url: string, platform: string): Promise<{
  visible_text: string;
  headings: string[];
  price_candidates: string[];
  screenshot_path: string | null;
}> {
  const BrowserBridge = await getBrowserBridge();
  const bridge = new BrowserBridge();
  const page = await bridge.connect({
    timeout: 45,
    workspace: `site:${platform}`,
  });

  await page.goto(url);
  await page.wait(4000);
  await page.autoScroll({ times: 3, delayMs: 800 });
  await page.wait(1000);

  const data = await page.evaluate(`
    (() => {
      const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');

      const text = (document.body.innerText || '').slice(0, 18000);

      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => str(h.textContent))
        .filter((t) => t && t.length < 250)
        .slice(0, 60);

      // Collect any element containing a price-like pattern — these are
      // usually package cards or buy-now ctas.
      const priceRE = /((?:US|HK|TWD|JPY|SGD|KRW|EUR|CNY|CHF|GBP|AUD|THB|VND)\\$?|[¥€£$])\\s*[\\d,]+(?:\\.\\d+)?/;
      const all = Array.from(document.querySelectorAll('*'));
      const priceCandidates = [];
      const seen = new Set();
      for (const el of all) {
        if (el.children.length > 4) continue;  // skip big wrappers
        const t = str(el.textContent);
        if (!t || t.length > 400 || t.length < 10) continue;
        if (!priceRE.test(t)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        priceCandidates.push(t);
        if (priceCandidates.length >= 80) break;
      }

      return {
        visible_text: text,
        headings,
        price_candidates: priceCandidates,
      };
    })()
  `) as any;

  // Take a screenshot for debug (best effort)
  let screenshotPath: string | null = null;
  try {
    const outDir = path.join(process.cwd(), 'data', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const hashShort = Buffer.from(url).toString('base64').slice(0, 10).replace(/[^a-zA-Z0-9]/g, '');
    screenshotPath = path.join(outDir, `agent-${platform}-${hashShort}.png`);
    await page.screenshot({ path: screenshotPath, format: 'png', fullPage: false });
  } catch { /* best-effort */ }

  return {
    visible_text: data?.visible_text ?? '',
    headings: Array.isArray(data?.headings) ? data.headings : [],
    price_candidates: Array.isArray(data?.price_candidates) ? data.price_candidates : [],
    screenshot_path: screenshotPath,
  };
}

/**
 * Ask the LLM to extract package / supplier data from the page snapshot.
 */
async function extractWithLLM(
  snapshot: {
    visible_text: string;
    headings: string[];
    price_candidates: string[];
  },
  context: { platform: string; url: string; activity_title?: string },
): Promise<AgentExtractResult> {
  const system =
    'You extract structured package data from OTA product pages. Return ONLY ' +
    'JSON matching the schema. Never invent data — use empty strings when the ' +
    "page doesn't clearly say a value. Prefer values that appear near a price.";

  const user = `Platform: ${context.platform}
URL: ${context.url}
Activity title: ${context.activity_title ?? '(unknown)'}

HEADINGS on the page (order as rendered):
${snapshot.headings.slice(0, 30).map((h, i) => `  ${i + 1}. ${h}`).join('\n')}

PRICE-BEARING TEXT BLOCKS (likely package cards, buy CTAs, option lists):
${snapshot.price_candidates.slice(0, 40).map((c, i) => `  [${i + 1}] ${c}`).join('\n')}

PAGE TEXT (truncated):
${snapshot.visible_text.slice(0, 7000)}

Extract the package list for THIS specific activity (not related-product
carousels, not sort dropdowns, not reviews). Each "package" is a buyable
variant of this tour: language guide / group size / meal option / vehicle etc.
Ignore "You might also like" / related products.

Return JSON:
{
  "packages": [
    { "name": "short package title", "price": "numeric only e.g. 48.25", "currency": "USD/JPY/HKD/...", "availability": "Available/Sold out", "language_hint": "English/Japanese/...", "group_size_hint": "big/small/-" }
  ],
  "supplier": "operator company name if shown, else empty",
  "languages": ["English", "Japanese", ...],
  "order_count": "e.g. 200K+ booked, 1234 travelers, or empty",
  "extraction_notes": "short sentence explaining your confidence"
}`;

  return await chatJSON<AgentExtractResult>(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.1, max_tokens: 2000 },
  );
}

export interface AgentFallbackInput {
  platform: string;
  url: string;
  activity_id: string;
  activity_title?: string;
}

export interface AgentFallbackResult {
  rows: PricingRowRaw[];
  supplier: string;
  languages_header: string;
  order_count: string;
  screenshot_path: string | null;
  notes: string;
  llm_model_used?: string;
}

export async function runAgentFallback(
  input: AgentFallbackInput,
): Promise<AgentFallbackResult> {
  const snapshot = await capturePageSnapshot(input.url, input.platform);
  const extracted = await extractWithLLM(snapshot, input);

  const checkedAt = new Date().toISOString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const travelDate = tomorrow.toISOString().slice(0, 10);

  const rows: PricingRowRaw[] = (extracted.packages ?? [])
    .filter((p) => p.name && p.price)
    .map((p, i) => ({
      ota: input.platform,
      activity_id: input.activity_id,
      activity_title: input.activity_title ?? '',
      activity_url: input.url,
      date: travelDate,
      check_date_time_gmt8: checkedAt,
      package_id: `agent-${i}`,
      package_name: p.name,
      group_title: p.language_hint ?? '',
      price: String(p.price).replace(/[^\d.]/g, ''),
      currency: (p.currency ?? '').toUpperCase().replace('$', '').trim() || 'USD',
      availability: p.availability ?? 'Available',
    }));

  return {
    rows,
    supplier: extracted.supplier ?? '',
    languages_header: Array.isArray(extracted.languages)
      ? extracted.languages.join('/')
      : '',
    order_count: extracted.order_count ?? '',
    screenshot_path: snapshot.screenshot_path,
    notes: extracted.extraction_notes ?? '',
  };
}
