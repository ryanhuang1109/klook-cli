/**
 * Multi-turn agent loop for pages that require interaction.
 *
 * The one-shot fallback (`agent-fallback.ts`) can read whatever the page
 * shows on first render. But GYG/Klook often hide package options behind
 * dropdowns or calendar pickers — you can't extract them without clicking.
 *
 * This loop gives the LLM a small vocabulary of actions and iterates:
 *
 *   snapshot → LLM chooses next action → execute → snapshot → …
 *
 * Exit when the LLM says `finish` (with extracted data) or max rounds hit.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chatJSON } from './llm.js';
import type { PricingRowRaw } from './types.js';

type Action =
  | { type: 'click_text'; text: string; rationale?: string }
  | { type: 'click_selector'; selector: string; rationale?: string }
  | { type: 'scroll_to'; text: string; rationale?: string }
  | { type: 'finish'; extracted: ExtractedData; rationale?: string }
  | { type: 'give_up'; reason: string };

export interface ExtractedData {
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
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

async function getBrowserBridge(): Promise<any> {
  try {
    // @ts-ignore — not public
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
 * Snapshot includes: page title, visible buttons/links with their text labels
 * (so the LLM can address them by text), recent price-bearing blocks, and a
 * small slice of innerText around whatever just changed.
 */
const SNAPSHOT_JS = `
  (() => {
    const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
    const title = str(document.title);
    const url = location.href;

    // Interactive elements — keep short, de-duped, safe to click
    const seenBtn = new Set();
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .map((el) => ({ text: str(el.textContent).slice(0, 80), tag: el.tagName.toLowerCase() }))
      .filter((b) => b.text && b.text.length > 0 && b.text.length < 80)
      .filter((b) => {
        if (seenBtn.has(b.text)) return false;
        seenBtn.add(b.text);
        return true;
      })
      .slice(0, 60);

    // Headings give structural context
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((h) => str(h.textContent))
      .filter((t) => t && t.length < 200)
      .slice(0, 30);

    // Price-bearing leaf elements
    const priceRE = /((?:US|HK|TWD|JPY|SGD|KRW|EUR|CNY|CHF|GBP|AUD|THB|VND)\\$?|[¥€£$])\\s*[\\d,]+(?:\\.\\d+)?/;
    const price_blocks = [];
    const seenPrice = new Set();
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 4) continue;
      const t = str(el.textContent);
      if (!t || t.length > 280 || t.length < 8) continue;
      if (!priceRE.test(t)) continue;
      if (seenPrice.has(t)) continue;
      seenPrice.add(t);
      price_blocks.push(t);
      if (price_blocks.length >= 40) break;
    }

    // A small slice of visible text for disambiguation
    const text = (document.body.innerText || '').slice(0, 7000);

    return { title, url, buttons, headings, price_blocks, text };
  })()
`;

function clickByTextJs(text: string): string {
  const escaped = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
  return `
    (() => {
      const t = '${escaped}'.trim();
      const els = Array.from(document.querySelectorAll('button, [role="button"], a, [role="tab"], [role="option"]'));
      const exact = els.find((e) => (e.textContent || '').trim() === t);
      const found = exact || els.find((e) => (e.textContent || '').trim().includes(t));
      if (!found) return { ok: false, reason: 'no-match' };
      try {
        found.scrollIntoView({ behavior: 'auto', block: 'center' });
        found.click();
        return { ok: true, matched: (found.textContent || '').trim().slice(0, 100) };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 160) };
      }
    })()
  `;
}

function clickBySelectorJs(selector: string): string {
  const escaped = selector.replace(/'/g, "\\'");
  return `
    (() => {
      const el = document.querySelector('${escaped}');
      if (!el) return { ok: false, reason: 'no-match' };
      try {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        el.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 160) };
      }
    })()
  `;
}

function scrollToTextJs(text: string): string {
  const escaped = text.replace(/'/g, "\\'");
  return `
    (() => {
      const t = '${escaped}'.trim();
      const els = Array.from(document.querySelectorAll('h1, h2, h3, h4, [class*="section"], [class*="heading"]'));
      const found = els.find((e) => (e.textContent || '').trim().includes(t));
      if (!found) return { ok: false, reason: 'no-match' };
      found.scrollIntoView({ behavior: 'auto', block: 'center' });
      return { ok: true };
    })()
  `;
}

function buildSystemPrompt(): string {
  return (
    'You drive a web-browsing agent to extract package and supplier data from OTA product pages.\n' +
    'At each step you receive a page snapshot and must return ONE action as JSON:\n' +
    '\n' +
    '  { "type": "click_text",     "text": "visible label to click", "rationale": "..." }\n' +
    '  { "type": "click_selector", "selector": "CSS selector",       "rationale": "..." }\n' +
    '  { "type": "scroll_to",      "text": "heading text to scroll to", "rationale": "..." }\n' +
    '  { "type": "finish",         "extracted": { <schema> },        "rationale": "done" }\n' +
    '  { "type": "give_up",        "reason": "why you can\'t extract" }\n' +
    '\n' +
    'Schema for finish.extracted:\n' +
    '{\n' +
    '  "packages": [{"name":"...","price":"numeric only","currency":"USD/JPY/...","availability":"Available/Sold out","language_hint":"English/...","group_size_hint":"big/small/-"}],\n' +
    '  "supplier": "operator company name, empty if not shown",\n' +
    '  "languages": ["English","Japanese",...],\n' +
    '  "order_count": "e.g. \'200K+ booked\' or empty",\n' +
    '  "confidence": "high|medium|low",\n' +
    '  "notes": "short explanation"\n' +
    '}\n' +
    '\n' +
    'Guidelines:\n' +
    '- If the page already shows packages clearly, call finish immediately.\n' +
    '- Click language/package/date dropdowns to reveal options you cannot see yet.\n' +
    '- Ignore "You might also like" / related products — those are different listings.\n' +
    '- Never invent prices. Use "" when unsure.\n' +
    '- Prefer click_text to click_selector when the label is unique and visible.\n' +
    '- Exit (finish) within 6 rounds; give_up if the page blocks extraction.'
  );
}

export interface AgentLoopInput {
  platform: string;
  url: string;
  activity_id: string;
  activity_title?: string;
  /** Extraction goal hint; defaults to a generic OTA package extraction. */
  goal?: string;
  maxRounds?: number;
  model?: string;
}

export interface AgentLoopResult {
  rows: PricingRowRaw[];
  supplier: string;
  languages_header: string;
  order_count: string;
  confidence: 'high' | 'medium' | 'low' | null;
  notes: string;
  rounds: Array<{
    round: number;
    action: Action;
    exec_result?: unknown;
    snapshot_excerpt?: string;
  }>;
  screenshot_path: string | null;
  gave_up: boolean;
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const BrowserBridge = await getBrowserBridge();
  const bridge = new BrowserBridge();
  const page = await bridge.connect({
    timeout: 60,
    workspace: `site:${input.platform}`,
  });

  await page.goto(input.url);
  await page.wait(4000);
  await page.autoScroll({ times: 2, delayMs: 600 });
  await page.wait(800);

  const maxRounds = input.maxRounds ?? 6;
  const history: AgentLoopResult['rounds'] = [];
  const goal =
    input.goal ??
    `Extract all package options (variants, prices, languages), the supplier name, total languages available, and the order/booking count for this activity: "${input.activity_title ?? input.url}".`;

  let finalExtract: ExtractedData | null = null;
  let gaveUp = false;

  for (let round = 1; round <= maxRounds; round++) {
    const snapshot = (await page.evaluate(SNAPSHOT_JS)) as any;

    const userMessage =
      `Round ${round}/${maxRounds}. Goal: ${goal}\n\n` +
      `URL: ${snapshot.url}\n` +
      `Title: ${snapshot.title}\n\n` +
      `HEADINGS:\n${(snapshot.headings ?? []).slice(0, 20).map((h: string) => `  - ${h}`).join('\n')}\n\n` +
      `CLICKABLE LABELS (buttons/links):\n${(snapshot.buttons ?? [])
        .slice(0, 40)
        .map((b: any) => `  [${b.tag}] "${b.text}"`)
        .join('\n')}\n\n` +
      `PRICE-BEARING BLOCKS (likely package cards):\n${(snapshot.price_blocks ?? [])
        .slice(0, 30)
        .map((t: string, i: number) => `  [${i + 1}] ${t}`)
        .join('\n')}\n\n` +
      `PAGE TEXT SLICE:\n${String(snapshot.text ?? '').slice(0, 3500)}\n\n` +
      `Decide the next action. If the packages are fully visible, call finish.`;

    let action: Action;
    try {
      action = await chatJSON<Action>(
        [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
        { model: input.model, temperature: 0.1, max_tokens: 2000 },
      );
    } catch (err) {
      history.push({
        round,
        action: { type: 'give_up', reason: `llm-error: ${(err as Error).message.slice(0, 180)}` },
        snapshot_excerpt: String(snapshot.title).slice(0, 120),
      });
      gaveUp = true;
      break;
    }

    history.push({ round, action, snapshot_excerpt: String(snapshot.title).slice(0, 120) });

    if (action.type === 'finish') {
      finalExtract = action.extracted;
      break;
    }
    if (action.type === 'give_up') {
      gaveUp = true;
      break;
    }

    try {
      if (action.type === 'click_text') {
        const r = (await page.evaluate(clickByTextJs(action.text))) as any;
        history[history.length - 1].exec_result = r;
        await page.wait(1100);
      } else if (action.type === 'click_selector') {
        const r = (await page.evaluate(clickBySelectorJs(action.selector))) as any;
        history[history.length - 1].exec_result = r;
        await page.wait(1100);
      } else if (action.type === 'scroll_to') {
        const r = (await page.evaluate(scrollToTextJs(action.text))) as any;
        history[history.length - 1].exec_result = r;
        await page.wait(500);
      }
    } catch (err) {
      history[history.length - 1].exec_result = {
        ok: false,
        reason: (err as Error).message.slice(0, 180),
      };
    }
  }

  // Capture final screenshot for audit
  let screenshotPath: string | null = null;
  try {
    const outDir = path.join(process.cwd(), 'data', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    screenshotPath = path.join(outDir, `agent-loop-${input.platform}-${input.activity_id}.png`);
    await page.screenshot({ path: screenshotPath, format: 'png', fullPage: false });
  } catch {
    /* best-effort */
  }

  const checkedAt = new Date().toISOString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const travelDate = tomorrow.toISOString().slice(0, 10);

  const rows: PricingRowRaw[] = (finalExtract?.packages ?? [])
    .filter((p) => p.name && p.price)
    .map((p, i) => ({
      ota: input.platform,
      activity_id: input.activity_id,
      activity_title: input.activity_title ?? '',
      activity_url: input.url,
      date: travelDate,
      check_date_time_gmt8: checkedAt,
      package_id: `agent-loop-${i}`,
      package_name: p.name,
      group_title: p.language_hint ?? '',
      price: String(p.price).replace(/[^\d.]/g, ''),
      currency: (p.currency ?? '').toUpperCase().replace('$', '').trim() || 'USD',
      availability: p.availability ?? 'Available',
    }));

  return {
    rows,
    supplier: finalExtract?.supplier ?? '',
    languages_header: Array.isArray(finalExtract?.languages)
      ? finalExtract!.languages.join('/')
      : '',
    order_count: finalExtract?.order_count ?? '',
    confidence: finalExtract?.confidence ?? null,
    notes: finalExtract?.notes ?? '',
    rounds: history,
    screenshot_path: screenshotPath,
    gave_up: gaveUp,
  };
}
