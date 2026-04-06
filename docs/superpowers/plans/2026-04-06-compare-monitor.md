# Compare & Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add POI-based competitor monitoring with LLM clustering and historical tracking across 4 travel platforms.

**Architecture:** New `src/poi/` and `src/compare/` modules. POI config in `~/.klook-cli/pois.json`. Compare command searches all platforms via `execFileSync('opencli', ...)`, sends results to OpenRouter LLM for clustering, outputs markdown/JSON. SQLite (`sql.js`) stores history for diff tracking.

**Tech Stack:** TypeScript, OpenRouter API (fetch), sql.js (pure JS SQLite), commander (CLI), execFileSync for platform search

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/types.ts` | Add `POI`, `CompareResult`, `CompareGroup`, `CompareProduct` types |
| `src/poi/poi.ts` | POI CRUD: `loadPois()`, `savePois()`, `addPoi()`, `removePoi()` — reads/writes `~/.klook-cli/pois.json` |
| `src/compare/llm.ts` | `clusterProducts(rawResults, query, date)` — calls OpenRouter API, returns `CompareResult` |
| `src/compare/store.ts` | `saveRun(poi, date, result)`, `getHistory(poi, days)` — SQLite via sql.js |
| `src/compare/formatter.ts` | `formatMarkdown(result)`, `formatJson(result)` — render CompareResult |
| `src/compare/compare.ts` | `runCompare(poi, date, opts)` — orchestrates search → LLM → format → save |
| `src/cli.ts` | Add `poi`, `compare`, `compare-history` subcommands |
| `tests/poi/poi.test.ts` | Unit tests for POI CRUD |
| `tests/compare/llm.test.ts` | Unit tests for LLM prompt building and response parsing |
| `tests/compare/store.test.ts` | Unit tests for SQLite store |
| `tests/compare/formatter.test.ts` | Unit tests for markdown/JSON formatting |

---

### Task 1: Add New Types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add types to `src/shared/types.ts`**

Append to the end of the file:

```typescript
/** A POI (Point of Interest) to monitor across platforms. */
export interface POI {
  name: string;
  keywords: string[];
  platforms: string[];
  date_range?: string;
}

/** A single product in a comparison group. */
export interface CompareProduct {
  platform: string;
  title: string;
  price_usd: number | null;
  price_original: string;
  rating: string;
  review_count: string;
  url: string;
  notes: string;
}

/** A group of similar/equivalent products across platforms. */
export interface CompareGroup {
  group_name: string;
  description: string;
  products: CompareProduct[];
  cheapest: string;
  best_rated: string;
}

/** Full comparison result from LLM clustering. */
export interface CompareResult {
  query: string;
  date: string;
  groups: CompareGroup[];
  currency_rates_used: string;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add POI and CompareResult types"
```

---

### Task 2: POI CRUD with Tests (TDD)

**Files:**
- Create: `src/poi/poi.ts`
- Create: `tests/poi/poi.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/poi/poi.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadPois, savePois, addPoi, removePoi } from '../../src/poi/poi.js';

describe('POI CRUD', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klook-cli-test-'));
    configDir = path.join(tmpDir, '.klook-cli');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadPois returns empty array when file does not exist', () => {
    const pois = loadPois(configDir);
    expect(pois).toEqual([]);
  });

  it('addPoi creates a new POI and persists it', () => {
    addPoi(configDir, {
      name: 'Mt Fuji day tour',
      keywords: ['Mt Fuji day tour', '富士山一日遊'],
      platforms: ['klook', 'trip', 'getyourguide', 'kkday'],
    });
    const pois = loadPois(configDir);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('Mt Fuji day tour');
    expect(pois[0].keywords).toEqual(['Mt Fuji day tour', '富士山一日遊']);
    expect(pois[0].platforms).toEqual(['klook', 'trip', 'getyourguide', 'kkday']);
  });

  it('addPoi rejects duplicate name', () => {
    addPoi(configDir, { name: 'USJ', keywords: ['USJ'], platforms: ['klook'] });
    expect(() => {
      addPoi(configDir, { name: 'USJ', keywords: ['USJ 2'], platforms: ['trip'] });
    }).toThrow('already exists');
  });

  it('removePoi removes by name', () => {
    addPoi(configDir, { name: 'A', keywords: ['a'], platforms: ['klook'] });
    addPoi(configDir, { name: 'B', keywords: ['b'], platforms: ['klook'] });
    removePoi(configDir, 'A');
    const pois = loadPois(configDir);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('B');
  });

  it('removePoi throws for nonexistent name', () => {
    expect(() => removePoi(configDir, 'nope')).toThrow('not found');
  });

  it('savePois and loadPois roundtrip', () => {
    const data = [
      { name: 'X', keywords: ['x1', 'x2'], platforms: ['klook', 'trip'] },
    ];
    savePois(configDir, data);
    const loaded = loadPois(configDir);
    expect(loaded).toEqual(data);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/poi/poi.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement POI CRUD**

```typescript
// src/poi/poi.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { POI } from '../shared/types.js';

const POIS_FILENAME = 'pois.json';

function defaultConfigDir(): string {
  return path.join(os.homedir(), '.klook-cli');
}

export function loadPois(configDir: string = defaultConfigDir()): POI[] {
  const filePath = path.join(configDir, POIS_FILENAME);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function savePois(configDir: string = defaultConfigDir(), pois: POI[]): void {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, POIS_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(pois, null, 2) + '\n', 'utf-8');
}

export function addPoi(configDir: string = defaultConfigDir(), poi: POI): void {
  const pois = loadPois(configDir);
  if (pois.some((p) => p.name === poi.name)) {
    throw new Error(`POI "${poi.name}" already exists`);
  }
  pois.push(poi);
  savePois(configDir, pois);
}

export function removePoi(configDir: string = defaultConfigDir(), name: string): void {
  const pois = loadPois(configDir);
  const idx = pois.findIndex((p) => p.name === name);
  if (idx === -1) {
    throw new Error(`POI "${name}" not found`);
  }
  pois.splice(idx, 1);
  savePois(configDir, pois);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/poi/poi.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/poi/poi.ts tests/poi/poi.test.ts
git commit -m "feat: add POI CRUD with tests"
```

---

### Task 3: LLM Client with Tests (TDD)

**Files:**
- Create: `src/compare/llm.ts`
- Create: `tests/compare/llm.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/compare/llm.test.ts
import { describe, it, expect } from 'vitest';
import { buildClusterPrompt, parseClusterResponse, __test__ } from '../../src/compare/llm.js';

describe('LLM client', () => {
  describe('buildClusterPrompt', () => {
    it('includes query, date, and product data', () => {
      const products = [
        { platform: 'klook', title: 'Mt Fuji Tour', price: 'HK$ 519', rating: '4.8', review_count: '28K', url: 'https://klook.com/1' },
        { platform: 'trip', title: 'Classic Mt Fuji', price: 'US$41.88', rating: '4.8', review_count: '5K', url: 'https://trip.com/2' },
      ];
      const prompt = buildClusterPrompt(products, 'Mt Fuji day tour', '2026-04-15');
      expect(prompt).toContain('Mt Fuji day tour');
      expect(prompt).toContain('2026-04-15');
      expect(prompt).toContain('klook');
      expect(prompt).toContain('trip');
      expect(prompt).toContain('HK$ 519');
      expect(prompt).toContain('US$41.88');
    });
  });

  describe('parseClusterResponse', () => {
    it('parses valid JSON response into CompareResult', () => {
      const raw = JSON.stringify({
        query: 'Mt Fuji',
        date: '2026-04-15',
        groups: [{
          group_name: 'Classic Tour',
          description: '6-spot day tour',
          products: [{
            platform: 'klook',
            title: 'Mt Fuji Tour',
            price_usd: 51.45,
            price_original: 'HK$ 519',
            rating: '4.8',
            review_count: '28K',
            url: 'https://klook.com/1',
            notes: 'most reviews',
          }],
          cheapest: 'klook',
          best_rated: 'klook',
        }],
        currency_rates_used: '1 HKD = 0.128 USD',
      });
      const result = parseClusterResponse(raw);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].group_name).toBe('Classic Tour');
      expect(result.groups[0].products[0].price_usd).toBe(51.45);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseClusterResponse('not json')).toThrow();
    });

    it('throws on missing groups field', () => {
      expect(() => parseClusterResponse(JSON.stringify({ query: 'x' }))).toThrow('groups');
    });
  });

  describe('getConfig', () => {
    it('reads API key from env', () => {
      const orig = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-key-123';
      const config = __test__.getConfig();
      expect(config.apiKey).toBe('test-key-123');
      if (orig) process.env.OPENROUTER_API_KEY = orig;
      else delete process.env.OPENROUTER_API_KEY;
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/compare/llm.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement LLM client**

```typescript
// src/compare/llm.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CompareResult } from '../shared/types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

interface LLMConfig {
  apiKey: string;
  model: string;
}

interface RawProduct {
  platform: string;
  title: string;
  price: string;
  rating: string;
  review_count: string;
  url: string;
}

export function getConfig(): LLMConfig {
  const configPath = path.join(os.homedir(), '.klook-cli', 'config.json');
  let fileConfig: Record<string, string> = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch { /* no config file */ }

  const apiKey = fileConfig.openrouter_api_key || process.env.OPENROUTER_API_KEY || '';
  const model = fileConfig.openrouter_model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return { apiKey, model };
}

const SYSTEM_PROMPT = `You are a travel product analyst. Given search results from multiple platforms for the same POI, group them into clusters of similar/equivalent products.

Rules:
- Group products that visit the same set of attractions with similar duration
- Convert all prices to USD (use approximate current rates, state rates used)
- For each group, identify the cheapest and best-rated option
- Flag notable differences (includes hotel pickup, meal, express pass, etc.)
- Output valid JSON matching the schema below. No other text.

Schema:
{
  "query": "string",
  "date": "string",
  "groups": [
    {
      "group_name": "string — short descriptive name",
      "description": "string — one sentence about what this group covers",
      "products": [
        {
          "platform": "klook | trip | getyourguide | kkday",
          "title": "string",
          "price_usd": number | null,
          "price_original": "string — original price as shown",
          "rating": "string",
          "review_count": "string",
          "url": "string",
          "notes": "string — notable differences or empty"
        }
      ],
      "cheapest": "string — platform name",
      "best_rated": "string — platform name"
    }
  ],
  "currency_rates_used": "string — e.g. 1 HKD ≈ 0.128 USD, 1 TWD ≈ 0.031 USD"
}`;

export function buildClusterPrompt(products: RawProduct[], query: string, date: string): string {
  const productList = products.map((p, i) =>
    `[${i + 1}] platform=${p.platform} | title=${p.title} | price=${p.price} | rating=${p.rating} | reviews=${p.review_count} | url=${p.url}`
  ).join('\n');

  return `Query: "${query}"\nDate: ${date}\nTotal products: ${products.length}\n\n${productList}`;
}

export function parseClusterResponse(raw: string): CompareResult {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!parsed.groups || !Array.isArray(parsed.groups)) {
    throw new Error('LLM response missing "groups" array');
  }
  return parsed as CompareResult;
}

export async function clusterProducts(
  products: RawProduct[],
  query: string,
  date: string,
): Promise<CompareResult> {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error(
      'OpenRouter API key not set. Set OPENROUTER_API_KEY env var or add openrouter_api_key to ~/.klook-cli/config.json'
    );
  }

  const userPrompt = buildClusterPrompt(products, query, date);

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty response');
  }

  return parseClusterResponse(content);
}

export const __test__ = { getConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/compare/llm.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compare/llm.ts tests/compare/llm.test.ts
git commit -m "feat: add OpenRouter LLM client for product clustering"
```

---

### Task 4: Formatter with Tests (TDD)

**Files:**
- Create: `src/compare/formatter.ts`
- Create: `tests/compare/formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/compare/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatMarkdown, formatJson } from '../../src/compare/formatter.js';
import type { CompareResult } from '../../src/shared/types.js';

const sampleResult: CompareResult = {
  query: 'Mt Fuji day tour',
  date: '2026-04-15',
  groups: [
    {
      group_name: 'Classic 6-Spot Day Tour',
      description: 'Lake Kawaguchi + Oshino Hakkai + Outlets, ~10 hours',
      products: [
        {
          platform: 'trip',
          title: 'Classic Panoramic Day Trip',
          price_usd: 41.88,
          price_original: 'US$41.88',
          rating: '4.8',
          review_count: '5,422',
          url: 'https://trip.com/detail/1',
          notes: 'cheapest',
        },
        {
          platform: 'klook',
          title: 'Mt Fuji popular scenic spot one-day tour',
          price_usd: 51.45,
          price_original: 'HK$519',
          rating: '4.8',
          review_count: '28,200+',
          url: 'https://klook.com/activity/93901',
          notes: 'most reviewed',
        },
      ],
      cheapest: 'trip',
      best_rated: 'klook',
    },
  ],
  currency_rates_used: '1 HKD ≈ 0.128 USD',
};

describe('formatter', () => {
  describe('formatMarkdown', () => {
    it('contains group name and products', () => {
      const md = formatMarkdown(sampleResult);
      expect(md).toContain('Classic 6-Spot Day Tour');
      expect(md).toContain('trip');
      expect(md).toContain('klook');
      expect(md).toContain('$41.88');
      expect(md).toContain('$51.45');
      expect(md).toContain('Mt Fuji day tour');
      expect(md).toContain('2026-04-15');
    });

    it('contains best price and best rated', () => {
      const md = formatMarkdown(sampleResult);
      expect(md).toContain('trip');
      expect(md).toContain('klook');
    });
  });

  describe('formatJson', () => {
    it('returns valid JSON string that roundtrips', () => {
      const json = formatJson(sampleResult);
      const parsed = JSON.parse(json);
      expect(parsed.query).toBe('Mt Fuji day tour');
      expect(parsed.groups).toHaveLength(1);
      expect(parsed.groups[0].products).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/compare/formatter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement formatter**

```typescript
// src/compare/formatter.ts
import type { CompareResult } from '../shared/types.js';

export function formatMarkdown(result: CompareResult): string {
  const lines: string[] = [];
  lines.push(`## ${result.query} — ${result.date}`);
  lines.push('');

  for (const group of result.groups) {
    lines.push(`### ${group.group_name}`);
    lines.push(`> ${group.description}`);
    lines.push('');
    lines.push('| Platform | Price (USD) | Original | Rating | Reviews | Notes |');
    lines.push('|----------|-------------|----------|--------|---------|-------|');

    for (const p of group.products) {
      const priceStr = p.price_usd != null ? `$${p.price_usd.toFixed(2)}` : '—';
      lines.push(`| ${p.platform} | ${priceStr} | ${p.price_original} | ${p.rating} | ${p.review_count} | ${p.notes} |`);
    }

    lines.push('');
    lines.push(`Best price: **${group.cheapest}** | Best rated: **${group.best_rated}**`);
    lines.push('');
  }

  if (result.currency_rates_used) {
    lines.push(`_Currency rates: ${result.currency_rates_used}_`);
  }

  return lines.join('\n');
}

export function formatJson(result: CompareResult): string {
  return JSON.stringify(result, null, 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/compare/formatter.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compare/formatter.ts tests/compare/formatter.test.ts
git commit -m "feat: add markdown and JSON formatters for compare results"
```

---

### Task 5: SQLite Store with Tests (TDD)

**Files:**
- Create: `src/compare/store.ts`
- Create: `tests/compare/store.test.ts`

- [ ] **Step 1: Install sql.js**

```bash
npm install sql.js
```

Note: `sql.js` ships its own TypeScript types. No separate `@types` package needed.

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/compare/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createStore, type CompareStore } from '../../src/compare/store.js';
import type { CompareResult } from '../../src/shared/types.js';

const sampleResult: CompareResult = {
  query: 'Mt Fuji',
  date: '2026-04-15',
  groups: [{
    group_name: 'Classic Tour',
    description: 'test',
    products: [{
      platform: 'klook', title: 'Tour', price_usd: 51.45,
      price_original: 'HK$519', rating: '4.8', review_count: '28K',
      url: 'https://klook.com/1', notes: '',
    }],
    cheapest: 'klook', best_rated: 'klook',
  }],
  currency_rates_used: '1 HKD = 0.128 USD',
};

describe('CompareStore', () => {
  let tmpDir: string;
  let store: CompareStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klook-cli-store-'));
    store = await createStore(tmpDir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveRun and getHistory roundtrip', () => {
    store.saveRun('Mt Fuji', '2026-04-15', sampleResult);
    const history = store.getHistory('Mt Fuji', 7);
    expect(history).toHaveLength(1);
    expect(history[0].poi_name).toBe('Mt Fuji');
    expect(history[0].date).toBe('2026-04-15');
    expect(history[0].result.groups).toHaveLength(1);
  });

  it('getHistory returns empty for unknown POI', () => {
    const history = store.getHistory('nonexistent', 7);
    expect(history).toEqual([]);
  });

  it('multiple saveRun calls accumulate', () => {
    store.saveRun('Mt Fuji', '2026-04-15', sampleResult);
    store.saveRun('Mt Fuji', '2026-04-16', sampleResult);
    const history = store.getHistory('Mt Fuji', 30);
    expect(history).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/compare/store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement SQLite store**

```typescript
// src/compare/store.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CompareResult } from '../shared/types.js';

interface HistoryRow {
  poi_name: string;
  date: string;
  run_at: string;
  result: CompareResult;
}

export interface CompareStore {
  saveRun(poiName: string, date: string, result: CompareResult): void;
  getHistory(poiName: string, days: number): HistoryRow[];
  close(): void;
}

export async function createStore(configDir?: string): Promise<CompareStore> {
  const sqljs = await import('sql.js');
  const initSqlJs = sqljs.default;

  const dir = configDir ?? path.join(os.homedir(), '.klook-cli');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'history.db');

  let dbBuffer: Buffer | null = null;
  try {
    dbBuffer = fs.readFileSync(dbPath);
  } catch { /* new db */ }

  const SQL = await initSqlJs();
  const db = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS compare_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poi_name TEXT NOT NULL,
      date TEXT NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      result_json TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_compare_runs_poi ON compare_runs(poi_name, date)`);

  function persist(): void {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  return {
    saveRun(poiName: string, date: string, result: CompareResult): void {
      db.run(
        'INSERT INTO compare_runs (poi_name, date, result_json) VALUES (?, ?, ?)',
        [poiName, date, JSON.stringify(result)]
      );
      persist();
    },

    getHistory(poiName: string, days: number): HistoryRow[] {
      const stmt = db.prepare(
        `SELECT poi_name, date, run_at, result_json FROM compare_runs
         WHERE poi_name = ? AND run_at >= datetime('now', ?)
         ORDER BY run_at DESC`,
      );
      stmt.bind([poiName, `-${days} days`]);
      const rows: HistoryRow[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        rows.push({
          poi_name: row.poi_name,
          date: row.date,
          run_at: row.run_at,
          result: JSON.parse(row.result_json),
        });
      }
      stmt.free();
      return rows;
    },

    close(): void {
      db.close();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/compare/store.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/compare/store.ts tests/compare/store.test.ts package.json package-lock.json
git commit -m "feat: add SQLite history store for compare results"
```

---

### Task 6: Compare Orchestrator

**Files:**
- Create: `src/compare/compare.ts`

- [ ] **Step 1: Implement compare orchestrator**

This module uses `execFileSync('opencli', ...)` to search each platform as a subprocess. This avoids browser lifecycle complexity — opencli handles it.

```typescript
// src/compare/compare.ts
import { execFileSync } from 'node:child_process';
import type { POI, CompareResult } from '../shared/types.js';
import type { KlookActivity } from '../shared/types.js';
import { loadPois } from '../poi/poi.js';
import { clusterProducts } from './llm.js';
import { formatMarkdown, formatJson } from './formatter.js';
import { createStore } from './store.js';

interface RawProduct {
  platform: string;
  title: string;
  price: string;
  rating: string;
  review_count: string;
  url: string;
}

function searchPlatform(platform: string, keywords: string[], limit: number): RawProduct[] {
  const allResults: RawProduct[] = [];
  const seenUrls = new Set<string>();

  for (const keyword of keywords) {
    try {
      const output = execFileSync('opencli', [
        platform, 'search', keyword, '--limit', String(limit), '-f', 'json',
      ], { encoding: 'utf-8', timeout: 90000 });

      // Strip non-JSON lines (e.g. "Update available" notices from opencli)
      const jsonStr = output
        .split('\n')
        .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
        .join('\n');
      const items = JSON.parse(jsonStr) as KlookActivity[];

      for (const item of items) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        allResults.push({
          platform,
          title: item.title,
          price: item.price,
          rating: item.rating,
          review_count: item.review_count,
          url: item.url,
        });
      }
    } catch {
      // Platform search failed — skip, others may still work
    }
  }

  return allResults;
}

export interface CompareOptions {
  date?: string;
  format?: 'markdown' | 'json';
  save?: boolean;
  limit?: number;
}

export async function runCompare(
  poiName: string,
  opts: CompareOptions = {},
): Promise<string> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const format = opts.format ?? 'markdown';
  const limit = opts.limit ?? 10;

  // Load POI config
  const pois = loadPois();
  const poi = pois.find((p) => p.name === poiName);
  if (!poi) {
    throw new Error(`POI "${poiName}" not found. Run: klook-cli poi add "${poiName}" --keywords "..."`);
  }

  // Search all platforms (sequential to avoid overwhelming browser bridge)
  const allProducts: RawProduct[] = [];
  for (const platform of poi.platforms) {
    const results = searchPlatform(platform, poi.keywords, limit);
    allProducts.push(...results);
  }

  if (allProducts.length === 0) {
    throw new Error(`No results found across any platform for "${poiName}"`);
  }

  // Cluster via LLM
  const result = await clusterProducts(allProducts, poiName, date);

  // Save to history if requested
  if (opts.save) {
    const store = await createStore();
    store.saveRun(poiName, date, result);
    store.close();
  }

  // Format output
  return format === 'json' ? formatJson(result) : formatMarkdown(result);
}

export async function runCompareAll(opts: CompareOptions = {}): Promise<string> {
  const pois = loadPois();
  if (pois.length === 0) {
    throw new Error('No POIs configured. Run: klook-cli poi add "..." --keywords "..."');
  }

  const outputs: string[] = [];
  for (const poi of pois) {
    try {
      const output = await runCompare(poi.name, opts);
      outputs.push(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outputs.push(`## ${poi.name}\n\nError: ${msg}\n`);
    }
  }

  return outputs.join('\n---\n\n');
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/compare/compare.ts
git commit -m "feat: add compare orchestrator — search, cluster, format, save"
```

---

### Task 7: Wire CLI Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `poi`, `compare`, and `compare-history` commands**

Add the following code to `src/cli.ts` immediately **before** the final `program.parse()` line:

```typescript
// ── POI commands ──────────────────────────────────────────────────
const poiCmd = program.command('poi').description('Manage POIs (Points of Interest) to monitor');

poiCmd
  .command('add <name>')
  .description('Add a POI to monitor')
  .requiredOption('--keywords <keywords>', 'Comma-separated search keywords')
  .option('--platforms <platforms>', 'Comma-separated platforms', 'klook,trip,getyourguide,kkday')
  .action(async (name: string, opts: { keywords: string; platforms: string }) => {
    const { addPoi } = await import('./poi/poi.js');
    try {
      addPoi(undefined, {
        name,
        keywords: opts.keywords.split(',').map((k) => k.trim()),
        platforms: opts.platforms.split(',').map((p) => p.trim()),
      });
      console.log(`Added POI: ${name}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

poiCmd
  .command('list')
  .description('List all configured POIs')
  .action(async () => {
    const { loadPois } = await import('./poi/poi.js');
    const pois = loadPois();
    if (pois.length === 0) {
      console.log('No POIs configured. Run: klook-cli poi add "..." --keywords "..."');
      return;
    }
    for (const poi of pois) {
      console.log(`${poi.name}`);
      console.log(`  Keywords: ${poi.keywords.join(', ')}`);
      console.log(`  Platforms: ${poi.platforms.join(', ')}`);
      console.log('');
    }
  });

poiCmd
  .command('remove <name>')
  .description('Remove a POI')
  .action(async (name: string) => {
    const { removePoi } = await import('./poi/poi.js');
    try {
      removePoi(undefined, name);
      console.log(`Removed POI: ${name}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Compare command ───────────────────────────────────────────────
program
  .command('compare [name]')
  .description('Compare a POI across platforms (or --all for all POIs)')
  .option('--date <date>', 'Date for pricing (YYYY-MM-DD)')
  .option('--all', 'Run comparison for all configured POIs')
  .option('--save', 'Save results to history database')
  .option('-f, --format <fmt>', 'Output format: markdown, json', 'markdown')
  .option('--limit <n>', 'Max results per platform', '10')
  .action(async (name: string | undefined, opts: any) => {
    const { runCompare, runCompareAll } = await import('./compare/compare.js');
    try {
      let output: string;
      const compareOpts = {
        date: opts.date,
        format: opts.format === 'json' ? 'json' as const : 'markdown' as const,
        save: opts.save ?? false,
        limit: parseInt(opts.limit) || 10,
      };

      if (opts.all) {
        output = await runCompareAll(compareOpts);
      } else if (name) {
        output = await runCompare(name, compareOpts);
      } else {
        console.error('Error: provide a POI name or use --all');
        process.exit(1);
        return;
      }
      console.log(output);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Compare history command ───────────────────────────────────────
program
  .command('compare-history <name>')
  .description('Show price change history for a POI')
  .option('--days <n>', 'Number of days to look back', '7')
  .action(async (name: string, opts: { days: string }) => {
    const { createStore } = await import('./compare/store.js');
    const days = parseInt(opts.days) || 7;
    const store = await createStore();
    const history = store.getHistory(name, days);
    store.close();

    if (history.length === 0) {
      console.log(`No history found for "${name}" in the last ${days} days.`);
      console.log('Run: klook-cli compare "..." --save');
      return;
    }

    console.log(`${name} — price history (last ${days} days)\n`);
    for (const run of history) {
      console.log(`=== ${run.run_at} (date: ${run.date}) ===`);
      for (const group of run.result.groups) {
        console.log(`  ${group.group_name}:`);
        for (const p of group.products) {
          const price = p.price_usd != null ? `$${p.price_usd.toFixed(2)}` : '—';
          console.log(`    ${p.platform}: ${price} (${p.price_original})`);
        }
      }
      console.log('');
    }
  });
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire poi, compare, and compare-history CLI commands"
```

---

### Task 8: Integration Test — Full Compare Flow

**Files:** None (verification only)

- [ ] **Step 1: Build**

```bash
npm run build
```

- [ ] **Step 2: Run all unit tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Add a test POI**

```bash
node dist/cli.js poi add "Mt Fuji day tour" --keywords "Mt Fuji day tour,富士山一日遊"
node dist/cli.js poi list
```

Expected: Shows the POI with keywords and all 4 platforms.

- [ ] **Step 4: Run compare (requires OPENROUTER_API_KEY)**

```bash
export OPENROUTER_API_KEY=sk-or-...
node dist/cli.js compare "Mt Fuji day tour" --date 2026-04-15 --save
```

Expected: Markdown output with grouped products and pricing comparison.

- [ ] **Step 5: Check history**

```bash
node dist/cli.js compare-history "Mt Fuji day tour" --days 7
```

Expected: Shows the saved run.

- [ ] **Step 6: Test JSON output**

```bash
node dist/cli.js compare "Mt Fuji day tour" --date 2026-04-15 -f json
```

Expected: Structured JSON with `groups`, `products`, `price_usd`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: verify full compare flow — POI, search, LLM cluster, history"
```
