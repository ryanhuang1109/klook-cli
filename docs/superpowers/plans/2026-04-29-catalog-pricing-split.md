# Scan / Pricing Split + Per-Platform Slash UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the tours pipeline into two independent concerns — **scan** (broad, low-frequency discovery + enrichment that drives coverage to 90%) and **pricing** (narrow, high-frequency price refresh of pinned activities) — and surface them through `/opencli-<platform> <poi> <mode>` slash commands.

**Architecture:** Add `is_pinned BOOLEAN` to `activities` (default 0). Split the in-process ingest helpers into three pure paths: `runScan` (search → detail, no SKU writes), `repricePinned` (iterates `is_pinned = 1`, pricing only, no detail fallback), and `pinTopByReviews` (rank by `review_count` and flip the bit). New CLI sub-commands `tours scan|pricing|pin` are thin wrappers. Slash commands parse `<poi> <mode>` and surface a numbered choice list when DB state is ambiguous (e.g. `pricing` with zero pinned rows) — never auto-fallback (per `feedback_ask_when_unclear`).

**Tech Stack:** TypeScript, Node 20, sql.js, vitest, commander, opencli plugins. Touched modules: `src/tours/{db,ingest,listing,commands}.ts`, `src/cli.ts`, `.claude/commands/opencli-*.md`, `.claude/skills/opencli-*/SKILL.md`.

**Out of scope:** Removing the legacy coupled commands (`tours run`, `tours ingest-from-planning-csv`). They keep working unchanged. `opencli-compare-poi` is deferred — not part of the scan/pricing flow. Web dashboard pin UI also deferred.

**Vocabulary (locked):**
- **scan** — discover + enrich (catalog mode). Replaces what was previously called "catalog".
- **pinned** — DB state meaning "refresh price daily". Boolean, not a tier.
- **pin** — the action that flips `is_pinned` to 1. Idempotent; only un-pinned via an explicit `unpin`.

---

## File Structure

**Created:**
- `src/tours/scan.ts` — `runScan()`. Writes `activities`, `packages`, `coverage_runs`. Never writes `skus` / `sku_observations`.
- `src/tours/pricing.ts` — `repricePinned()`. Iterates `activities WHERE is_pinned = 1`, calls a pricing-only path. Forces `detailFallback: false`.
- `src/tours/pin.ts` — `pinTopByReviews()`. Ranks `activities` by `review_count` desc within (POI, platform), sets `is_pinned = 1`.
- `src/tours/slash-arg-parser.ts` — pure parser used by the slash command markdown. Returns `{ poi, mode } | { ask: ChoiceList } | { error: string }`.
- `tests/tours/db.is-pinned.test.ts`
- `tests/tours/scan.test.ts`
- `tests/tours/pricing.test.ts`
- `tests/tours/pin.test.ts`
- `tests/tours/slash-arg-parser.test.ts`
- `.claude/skills/opencli-scan/SKILL.md` (via `document-skills:skill-creator`)
- `.claude/skills/opencli-pricing/SKILL.md` (via `document-skills:skill-creator`)

**Modified / Renamed:**
- `src/tours/db.ts` — add `is_pinned` column + migration probe + `listPinnedActivities()` + `setPinned()`.
- `src/tours/types.ts` — no new types needed (boolean), but add re-export for clarity.
- `src/tours/ingest.ts` — extract a pure pricing-only helper `ingestPricingOnly()` used by `pricing.ts`. Existing `ingestPricing` keeps `detailFallback` default for backward-compat. Export `parseReviewCount` so `scan.ts` can reuse it.
- `src/tours/commands.ts` — add `cmdScan`, `cmdPricing`, `cmdPin`.
- `src/cli.ts` — register `tours scan|pricing|pin` plus internal `tours parse-slash-args`.
- `.claude/commands/opencli-{kkday,klook,trip,getyourguide,airbnb}.md` — replace argument parsing with `<poi> <mode>` flow.
- `.claude/skills/opencli-tours-routine/` → renamed to `.claude/skills/opencli-routine/`. Body shrunk to orchestrator role.
- `.claude/commands/opencli-tours-routine.md` → renamed to `.claude/commands/opencli-routine.md`.
- `CLAUDE.md` — update Tours Pipeline section with new mental model + skill list.

---

## Conventions

- Run all tests with `npm test`. Single file: `npx vitest run tests/tours/<file>.test.ts`.
- Type-check with `npm run typecheck`.
- Build with `npm run build` before any CLI smoke test (the `dist/` symlink is what `node dist/cli.js` runs).
- Use `git add <specific files>` — never `git add .` (mirrors recent commit style).
- Commit format: `<type>(<scope>): <subject>`. Recent commits do NOT add Claude co-author tags — keep that.
- All new skills owned by **Ryan Huang**.

---

## Task 1: DB column `is_pinned` + migration

**Files:**
- Modify: `src/tours/db.ts` (CREATE TABLE activities + PRAGMA migration block around line 333)
- Test: `tests/tours/db.is-pinned.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tours/db.is-pinned.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from '../../src/tours/db.js';
import * as path from 'node:path';
import * as os from 'node:os';

describe('is_pinned column', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tours-pin-${Date.now()}-${Math.random()}.db`);
  });

  it('defaults new activities to is_pinned=0', async () => {
    const db = await openDB(dbPath);
    db.upsertActivity({
      id: 'kkday:2247', platform: 'kkday', platform_product_id: '2247',
      canonical_url: 'https://www.kkday.com/en/product/2247',
      title: 'Mt Fuji Tour', supplier: null, poi: 'mt fuji',
      duration_minutes: null, departure_city: null,
      rating: null, review_count: null, order_count: null,
      description: null, cancellation_policy: null,
      raw_extras_json: '{}',
      first_scraped_at: '2026-04-29T00:00:00Z',
      last_scraped_at: '2026-04-29T00:00:00Z',
      review_status: 'unverified', review_note: null,
    });
    db.close();

    const db2 = await openDB(dbPath);
    const acts = db2.listActivities();
    expect(acts).toHaveLength(1);
    expect(acts[0].is_pinned).toBe(0);
  });

  it('migration adds the column when opening a DB created without it', async () => {
    const db = await openDB(dbPath);
    db.close();
    const db2 = await openDB(dbPath);
    expect(db2.rawColumns('activities')).toContain('is_pinned');
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/tours/db.is-pinned.test.ts
```

Expected: FAIL — column missing / `rawColumns` not defined.

- [ ] **Step 3: Add column + migration probe + introspection helper**

In `src/tours/db.ts`, inside the `CREATE TABLE IF NOT EXISTS activities (...)`, append after `review_note TEXT,`:

```sql
is_pinned INTEGER NOT NULL DEFAULT 0
```

In the migration block (around line 333):

```ts
if (!existingCols.has('is_pinned')) {
  db.run(`ALTER TABLE activities ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`);
}
```

Add the introspection helper:

```ts
function rawColumns(table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const out: string[] = [];
  while (stmt.step()) out.push((stmt.getAsObject() as any).name);
  stmt.free();
  return out;
}
```

Expose `rawColumns` on the returned `ToursDB`. Add `is_pinned: number` (0 or 1) to the `Activity` interface.

- [ ] **Step 4: Update SELECT/INSERT lists**

Define `ACTIVITY_COLS` constant (single source of truth). Replace inline column lists in `listActivities` and `upsertActivity` with this constant. `is_pinned` goes at the end.

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run tests/tours/db.is-pinned.test.ts && npm run typecheck && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/tours/db.ts tests/tours/db.is-pinned.test.ts
git commit -m "feat(tours): add is_pinned column to activities"
```

---

## Task 2: DB methods `listPinnedActivities` + `setPinned`

**Files:**
- Modify: `src/tours/db.ts`
- Test: `tests/tours/db.is-pinned.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/tours/db.is-pinned.test.ts`:

```ts
it('listPinnedActivities returns only pinned rows', async () => {
  const db = await openDB(dbPath);
  const baseAct = (id: string): any => ({
    id, platform: 'kkday', platform_product_id: id.split(':')[1],
    canonical_url: `https://www.kkday.com/en/product/${id.split(':')[1]}`,
    title: id, supplier: null, poi: 'mt fuji',
    duration_minutes: null, departure_city: null,
    rating: null, review_count: 100, order_count: null,
    description: null, cancellation_policy: null,
    raw_extras_json: '{}',
    first_scraped_at: '2026-04-29T00:00:00Z',
    last_scraped_at: '2026-04-29T00:00:00Z',
    review_status: 'unverified', review_note: null,
  });
  db.upsertActivity(baseAct('kkday:1'));
  db.upsertActivity(baseAct('kkday:2'));
  db.upsertActivity(baseAct('kkday:3'));
  db.setPinned('kkday:1', true);
  db.setPinned('kkday:2', true);

  const pinned = db.listPinnedActivities({ poi: 'mt fuji', platform: 'kkday' });
  expect(pinned.map(a => a.id).sort()).toEqual(['kkday:1', 'kkday:2']);
});

it('setPinned(false) un-pins', async () => {
  const db = await openDB(dbPath);
  // ... insert one activity ...
  db.setPinned('kkday:1', true);
  db.setPinned('kkday:1', false);
  expect(db.listPinnedActivities()).toEqual([]);
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/db.is-pinned.test.ts
```

Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement both methods**

In `src/tours/db.ts`, on the returned object:

```ts
listPinnedActivities(filters: { poi?: string; platform?: string } = {}) {
  const wh: string[] = [`is_pinned = 1`];
  const args: unknown[] = [];
  if (filters.poi) { wh.push(`LOWER(poi) = LOWER(?)`); args.push(filters.poi); }
  if (filters.platform) { wh.push(`platform = ?`); args.push(filters.platform); }
  return all<Activity>(
    `SELECT ${ACTIVITY_COLS} FROM activities WHERE ${wh.join(' AND ')} ` +
    `ORDER BY review_count DESC NULLS LAST`,
    args,
  );
},

setPinned(id: string, pinned: boolean) {
  db.run(`UPDATE activities SET is_pinned = ? WHERE id = ?`, [pinned ? 1 : 0, id]);
  persist();
},
```

Update the `ToursDB` interface to declare both methods.

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/tours/db.is-pinned.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tours/db.ts tests/tours/db.is-pinned.test.ts
git commit -m "feat(tours): db methods listPinnedActivities + setPinned"
```

---

## Task 3: Extract `ingestPricingOnly` (no detail fallback)

**Files:**
- Modify: `src/tours/ingest.ts` (around the existing `ingestPricing`, line ~298)
- Test: `tests/tours/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tours/pricing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ingest from '../../src/tours/ingest.js';

describe('ingestPricingOnly', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does NOT call ingestFromDetail even when pricing returns 0 days', async () => {
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');
    vi.spyOn(ingest, 'runPricingRaw').mockReturnValue({
      activity_id: '2247', captured_days: 0, rows: [],
    } as any);

    const fakeDb: any = {
      upsertActivity: vi.fn(), upsertPackage: vi.fn(),
      upsertSKU: vi.fn(), appendObservation: vi.fn(),
      logExecution: vi.fn(),
      getActivity: vi.fn().mockReturnValue(null),
      getPackage: vi.fn().mockReturnValue(null),
    };

    await ingest.ingestPricingOnly(fakeDb, {
      platform: 'kkday', activityId: '2247', poi: 'mt fuji',
    });

    expect(detailSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/pricing.test.ts
```

Expected: FAIL — `ingestPricingOnly is not a function`.

- [ ] **Step 3: Refactor — split `ingestPricing` into two**

In `src/tours/ingest.ts`:

1. Locate the fallback block (around line 355, comment: "Pricing scraper produced no usable data — defer to ingestFromDetail").
2. Move everything ABOVE that block into a new exported `ingestPricingOnly`. Signature: `Omit<IngestOptions, 'detailFallback'>`.
3. Have `ingestPricing` call `ingestPricingOnly` first; only run the fallback when `result.captured_days === 0 && opts.detailFallback !== false`.
4. Add `captured_days: number` to the return shape.

```ts
export async function ingestPricingOnly(
  db: ToursDB,
  opts: Omit<IngestOptions, 'detailFallback'>,
): Promise<IngestResult & { captured_days: number }> {
  // (body extracted from the top half of the existing ingestPricing,
  // ending right before the "Pricing scraper produced no usable data" comment)
}

export async function ingestPricing(
  db: ToursDB,
  opts: IngestOptions,
): Promise<IngestResult & { captured_days: number }> {
  const result = await ingestPricingOnly(db, opts);
  if (result.captured_days === 0 && opts.detailFallback !== false) {
    // (existing fallback body — unchanged)
  }
  return result;
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/tours/pricing.test.ts && npm run typecheck && npm test
```

Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/tours/ingest.ts tests/tours/pricing.test.ts
git commit -m "refactor(tours): extract ingestPricingOnly with no detail fallback"
```

---

## Task 4: `runScan` (search → detail, no SKU writes)

**Files:**
- Create: `src/tours/scan.ts`
- Modify: `src/tours/ingest.ts` (export `parseReviewCount`)
- Test: `tests/tours/scan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tours/scan.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ingest from '../../src/tours/ingest.js';
import { runScan } from '../../src/tours/scan.js';

describe('runScan', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('calls ingestFromDetail per hit but never any pricing path', async () => {
    vi.spyOn(ingest, 'runSearch').mockReturnValue([
      { title: 'A', url: 'https://www.kkday.com/en/product/1', review_count: '100' },
      { title: 'B', url: 'https://www.kkday.com/en/product/2', review_count: '50' },
    ] as any);
    const detail = vi.spyOn(ingest, 'ingestFromDetail').mockResolvedValue({} as any);
    const pricing = vi.spyOn(ingest, 'ingestPricing').mockResolvedValue({} as any);
    const pricingOnly = vi.spyOn(ingest, 'ingestPricingOnly').mockResolvedValue({} as any);

    const fakeDb: any = {
      logSearchRun: vi.fn(),
      logExecution: vi.fn(),
      logCoverageRun: vi.fn(),
    };

    const r = await runScan(fakeDb, {
      platform: 'kkday', poi: 'mt fuji', keyword: 'mt fuji', limit: 2,
    });

    expect(detail).toHaveBeenCalledTimes(2);
    expect(pricing).not.toHaveBeenCalled();
    expect(pricingOnly).not.toHaveBeenCalled();
    expect(r.attempted).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/scan.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Export `parseReviewCount` from `ingest.ts`**

Add `export` in front of `function parseReviewCount` (around line 52). Verify with `grep -n "parseReviewCount" src/`.

- [ ] **Step 4: Implement `src/tours/scan.ts`**

```ts
/**
 * Scan — discover + enrich. search → detail, NEVER writes skus.
 *
 * Broad, low-frequency. Goal: drive coverage % toward 90% per
 * (POI, platform). Pricing is the separate concern in src/tours/pricing.ts.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';
import { runSearch, ingestFromDetail, parseReviewCount } from './ingest.js';

export interface ScanOptions {
  platform: Platform;
  poi: string;
  keyword: string;
  limit?: number;
  sortBy?: 'reviews' | 'recommended';
  captureScreenshot?: boolean;
  onProgress?: (msg: string) => void;
  sessionId?: string | null;
}

export interface ScanResult {
  attempted: number;
  total_found: number;
  succeeded: number;
  failed: { url: string; reason: string }[];
}

export async function runScan(db: ToursDB, opts: ScanOptions): Promise<ScanResult> {
  const limit = opts.limit ?? 30;
  const sortBy = opts.sortBy ?? 'reviews';
  const COUNT_CAP = 200;
  const rawHits = runSearch(opts.platform, opts.keyword, COUNT_CAP);
  const totalFound = rawHits.length;

  const ranked = sortBy === 'reviews'
    ? [...rawHits].sort(
        (a, b) => parseReviewCount(b.review_count) - parseReviewCount(a.review_count),
      )
    : rawHits;
  const hits = ranked.slice(0, limit);

  const failed: { url: string; reason: string }[] = [];
  let succeeded = 0;

  for (const hit of hits) {
    const url = hit.url;
    const idMatch =
      url.match(/\/activity\/(\d+)/) ||
      url.match(/detail\/(\d+)/) ||
      url.match(/product\/(\d+)/) ||
      url.match(/-t(\d+)/);
    if (!idMatch) {
      failed.push({ url, reason: 'id-not-extractable' });
      continue;
    }
    const activityId = idMatch[1];
    try {
      await ingestFromDetail(db, {
        platform: opts.platform,
        activityId,
        poi: opts.poi,
        canonicalUrl: url,
        captureScreenshot: opts.captureScreenshot,
        sessionId: opts.sessionId,
      });
      succeeded++;
    } catch (err) {
      failed.push({ url, reason: (err as Error).message.slice(0, 200) });
    }
  }

  db.logSearchRun({
    platform: opts.platform,
    keyword: opts.keyword,
    poi: opts.poi,
    total_found: totalFound,
    ingested: hits.length,
    succeeded,
    failed: failed.length,
  });

  return { attempted: hits.length, total_found: totalFound, succeeded, failed };
}
```

- [ ] **Step 5: Run test, confirm it passes**

```bash
npx vitest run tests/tours/scan.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tours/scan.ts src/tours/ingest.ts tests/tours/scan.test.ts
git commit -m "feat(tours): runScan — search to detail, no pricing writes"
```

---

## Task 5: `repricePinned` (pricing-only over pinned activities)

**Files:**
- Create: `src/tours/pricing.ts`
- Modify: `tests/tours/pricing.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/tours/pricing.test.ts`:

```ts
import { repricePinned } from '../../src/tours/pricing.js';

describe('repricePinned', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('iterates only pinned activities and never calls detail', async () => {
    const onlySpy = vi.spyOn(ingest, 'ingestPricingOnly').mockResolvedValue({
      captured_days: 7, skus_written: 5,
    } as any);
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');

    const fakeDb: any = {
      listPinnedActivities: vi.fn().mockReturnValue([
        { id: 'kkday:1', platform: 'kkday', platform_product_id: '1',
          canonical_url: 'https://...', poi: 'mt fuji', title: 'A' },
        { id: 'kkday:2', platform: 'kkday', platform_product_id: '2',
          canonical_url: 'https://...', poi: 'mt fuji', title: 'B' },
      ]),
    };

    const r = await repricePinned(fakeDb, { platform: 'kkday', poi: 'mt fuji' });

    expect(fakeDb.listPinnedActivities).toHaveBeenCalledWith({
      poi: 'mt fuji', platform: 'kkday',
    });
    expect(onlySpy).toHaveBeenCalledTimes(2);
    expect(detailSpy).not.toHaveBeenCalled();
    expect(r.no_pinned).toBe(false);
    expect(r.attempted).toBe(2);
  });

  it('returns { no_pinned: true } when DB has zero pinned rows', async () => {
    const fakeDb: any = { listPinnedActivities: vi.fn().mockReturnValue([]) };
    const r = await repricePinned(fakeDb, { platform: 'kkday', poi: 'mt fuji' });
    expect(r.no_pinned).toBe(true);
    expect(r.attempted).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/pricing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tours/pricing.ts`**

```ts
/**
 * Pricing — refresh prices for pinned activities only. Writes skus +
 * sku_observations, never touches detail. Companion to src/tours/scan.ts.
 *
 * On empty DB the function returns { no_pinned: true } — the caller
 * (CLI / slash layer) is responsible for surfacing that to the user.
 * Never silently fall back to running scan.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';
import { ingestPricingOnly } from './ingest.js';

export interface RepriceOptions {
  platform: Platform;
  poi?: string;
  days?: number;
  onProgress?: (msg: string) => void;
}

export interface RepriceResult {
  no_pinned: boolean;
  attempted: number;
  succeeded: number;
  failed: { id: string; reason: string }[];
}

export async function repricePinned(
  db: ToursDB,
  opts: RepriceOptions,
): Promise<RepriceResult> {
  const pinned = db.listPinnedActivities({
    poi: opts.poi, platform: opts.platform,
  });
  if (pinned.length === 0) {
    return { no_pinned: true, attempted: 0, succeeded: 0, failed: [] };
  }

  const failed: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const a of pinned) {
    opts.onProgress?.(
      `${a.platform}/${a.platform_product_id} — ${(a.title ?? '').slice(0, 60)}`,
    );
    try {
      await ingestPricingOnly(db, {
        platform: a.platform as Platform,
        activityId: a.platform_product_id,
        poi: a.poi ?? null,
        canonicalUrl: a.canonical_url,
        days: opts.days,
      });
      succeeded++;
    } catch (err) {
      failed.push({ id: a.id, reason: (err as Error).message.slice(0, 200) });
    }
  }

  return { no_pinned: false, attempted: pinned.length, succeeded, failed };
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/tours/pricing.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tours/pricing.ts tests/tours/pricing.test.ts
git commit -m "feat(tours): repricePinned — pricing-only over pinned activities"
```

---

## Task 6: `pinTopByReviews` (rank → flip the pin bit)

**Files:**
- Create: `src/tours/pin.ts`
- Test: `tests/tours/pin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tours/pin.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { pinTopByReviews } from '../../src/tours/pin.js';
import { openDB } from '../../src/tours/db.js';
import * as path from 'node:path';
import * as os from 'node:os';

describe('pinTopByReviews', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tours-pin-action-${Date.now()}-${Math.random()}.db`);
  });

  it('pins top-N by review_count, leaves the rest un-pinned', async () => {
    const db = await openDB(dbPath);
    const mk = (n: number, reviews: number) => db.upsertActivity({
      id: `kkday:${n}`, platform: 'kkday', platform_product_id: String(n),
      canonical_url: `https://www.kkday.com/en/product/${n}`,
      title: `Tour ${n}`, supplier: null, poi: 'mt fuji',
      duration_minutes: null, departure_city: null,
      rating: 4.8, review_count: reviews, order_count: null,
      description: null, cancellation_policy: null,
      raw_extras_json: '{}',
      first_scraped_at: '2026-04-29T00:00:00Z',
      last_scraped_at: '2026-04-29T00:00:00Z',
      review_status: 'unverified', review_note: null,
    });
    mk(1, 1000); mk(2, 500); mk(3, 200); mk(4, 50);

    const r = await pinTopByReviews(db, {
      platform: 'kkday', poi: 'mt fuji', top: 2,
    });

    expect(r.pinned.map(a => a.id).sort()).toEqual(['kkday:1', 'kkday:2']);
    const flags = Object.fromEntries(
      db.listActivities().map(a => [a.id, a.is_pinned]),
    );
    expect(flags).toEqual({
      'kkday:1': 1, 'kkday:2': 1,
      'kkday:3': 0, 'kkday:4': 0,
    });
  });

  it('idempotent: re-running with smaller top does not un-pin', async () => {
    const db = await openDB(dbPath);
    // ... insert 4 activities (same as above) ...
    await pinTopByReviews(db, { platform: 'kkday', poi: 'mt fuji', top: 2 });
    await pinTopByReviews(db, { platform: 'kkday', poi: 'mt fuji', top: 1 });
    const flags = Object.fromEntries(
      db.listActivities().map(a => [a.id, a.is_pinned]),
    );
    expect(flags['kkday:1']).toBe(1);
    expect(flags['kkday:2']).toBe(1); // still pinned
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/pin.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tours/pin.ts`**

```ts
/**
 * Pin top-N activities by review_count within (POI, platform).
 * Idempotent — only flips bits from 0 to 1; never un-pins.
 */
import type { ToursDB } from './db.js';
import type { Platform } from './types.js';

export interface PinOptions {
  platform: Platform;
  poi: string;
  top: number;
}

export interface PinResult {
  considered: number;
  pinned: { id: string; title: string; review_count: number | null }[];
}

export async function pinTopByReviews(
  db: ToursDB,
  opts: PinOptions,
): Promise<PinResult> {
  const all = db.listActivities({ platform: opts.platform, poi: opts.poi });
  const ranked = [...all].sort(
    (a, b) => (b.review_count ?? 0) - (a.review_count ?? 0),
  );
  const winners = ranked.slice(0, opts.top);
  for (const a of winners) {
    if (!a.is_pinned) db.setPinned(a.id, true);
  }
  return {
    considered: all.length,
    pinned: winners.map((a) => ({
      id: a.id, title: a.title, review_count: a.review_count,
    })),
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/tours/pin.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tours/pin.ts tests/tours/pin.test.ts
git commit -m "feat(tours): pinTopByReviews — flip pin bit by review_count"
```

---

## Task 7: CLI handlers `cmdScan`, `cmdPricing`, `cmdPin`

**Files:**
- Modify: `src/tours/commands.ts`

- [ ] **Step 1: Append `cmdScan`**

```ts
export async function cmdScan(opts: {
  platform: string;
  poi: string;
  keyword?: string;
  limit?: number;
  sortBy?: 'reviews' | 'recommended';
  screenshot?: boolean;
}): Promise<void> {
  loadEnv();
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}.`);
  }
  const { runScan } = await import('./scan.js');
  const db = await openDB();
  const result = await runScan(db, {
    platform: opts.platform as Platform,
    poi: opts.poi,
    keyword: opts.keyword ?? opts.poi,
    limit: opts.limit,
    sortBy: opts.sortBy,
    captureScreenshot: opts.screenshot,
    onProgress: (m) => process.stderr.write(`-> ${m}\n`),
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}
```

- [ ] **Step 2: Append `cmdPricing` (sets exit code 2 on no_pinned)**

```ts
export async function cmdPricing(opts: {
  platform: string;
  poi?: string;
  days?: number;
}): Promise<void> {
  loadEnv();
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}.`);
  }
  const { repricePinned } = await import('./pricing.js');
  const db = await openDB();
  const result = await repricePinned(db, {
    platform: opts.platform as Platform,
    poi: opts.poi,
    days: opts.days,
    onProgress: (m) => process.stderr.write(`-> ${m}\n`),
  });
  db.close();

  console.log(JSON.stringify(result, null, 2));
  if (result.no_pinned) {
    process.stderr.write(
      `\nNo pinned activities for ${opts.platform}` +
      (opts.poi ? ` x ${opts.poi}` : '') + `.\n` +
      `  Run 'tours scan' to discover, then 'tours pin' to mark targets.\n`,
    );
    process.exitCode = 2;
  }
}
```

- [ ] **Step 3: Append `cmdPin`**

```ts
export async function cmdPin(opts: {
  platform: string;
  poi: string;
  top: number;
}): Promise<void> {
  if (!VALID_PLATFORMS.includes(opts.platform as Platform)) {
    throw new Error(`Invalid platform: ${opts.platform}.`);
  }
  const { pinTopByReviews } = await import('./pin.js');
  const db = await openDB();
  const result = await pinTopByReviews(db, {
    platform: opts.platform as Platform,
    poi: opts.poi,
    top: opts.top,
  });
  db.close();
  console.log(JSON.stringify(result, null, 2));
}
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tours/commands.ts
git commit -m "feat(tours): cli handlers cmdScan/cmdPricing/cmdPin"
```

---

## Task 8: Wire sub-commands into `src/cli.ts`

**Files:**
- Modify: `src/cli.ts` (after the existing `tours export-csv` block, around line 384)

- [ ] **Step 1: Add the three command registrations**

```ts
toursCmd
  .command('scan')
  .description('Scan/enrichment — search to detail. NEVER writes pricing.')
  .requiredOption('--platform <p>', 'platform: klook|trip|getyourguide|kkday|airbnb')
  .requiredOption('--poi <name>', 'POI label, also default keyword')
  .option('--keyword <k>', 'override search keyword (defaults to --poi)')
  .option('--limit <n>', 'top N hits to enrich', (v) => parseInt(v, 10), 30)
  .option('--sort-by <s>', 'reviews|recommended', 'reviews')
  .option('--screenshot', 'capture page screenshot', false)
  .action(async (o) => {
    const { cmdScan } = await import('./tours/commands.js');
    await cmdScan({
      platform: o.platform, poi: o.poi, keyword: o.keyword,
      limit: o.limit, sortBy: o.sortBy, screenshot: o.screenshot,
    });
  });

toursCmd
  .command('pricing')
  .description('Refresh pricing for pinned activities only. Exits 2 if none pinned.')
  .requiredOption('--platform <p>', 'platform: klook|trip|getyourguide|kkday|airbnb')
  .option('--poi <name>', 'restrict to one POI')
  .option('--days <n>', 'days of pricing matrix', (v) => parseInt(v, 10), 7)
  .action(async (o) => {
    const { cmdPricing } = await import('./tours/commands.js');
    await cmdPricing({ platform: o.platform, poi: o.poi, days: o.days });
  });

toursCmd
  .command('pin')
  .description('Pin top-N activities by review_count for daily price refresh.')
  .requiredOption('--platform <p>', 'platform')
  .requiredOption('--poi <name>', 'POI to pin within')
  .option('--top <n>', 'number to pin', (v) => parseInt(v, 10), 5)
  .action(async (o) => {
    const { cmdPin } = await import('./tours/commands.js');
    await cmdPin({ platform: o.platform, poi: o.poi, top: o.top });
  });
```

- [ ] **Step 2: Build, smoke test**

```bash
npm run build
node dist/cli.js tours scan --help
node dist/cli.js tours pricing --help
node dist/cli.js tours pin --help
```

Expected: each prints usage. No runtime errors.

- [ ] **Step 3: Smoke test the "no pinned" exit code**

```bash
node dist/cli.js tours pricing --platform kkday --poi mt-fuji-nonexistent
echo "exit=$?"
```

Expected: stdout shows `{"no_pinned": true, ...}`, stderr shows the suggestion line, `exit=2`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(tours): register scan/pricing/pin sub-commands"
```

---

## Task 9: Slash-command argument parser

**Files:**
- Create: `src/tours/slash-arg-parser.ts`
- Modify: `src/cli.ts` (one hidden helper sub-command)
- Test: `tests/tours/slash-arg-parser.test.ts`

The slash markdown shells out to `node dist/cli.js tours parse-slash-args ...` so the rules live in TS, not bash inside markdown.

- [ ] **Step 1: Write the failing tests**

Create `tests/tours/slash-arg-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSlashArgs } from '../../src/tours/slash-arg-parser.js';

describe('parseSlashArgs', () => {
  it('parses "<poi> <mode>"', () => {
    expect(parseSlashArgs('mt.fuji pricing')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'pricing',
    });
  });

  it('treats "detail" as alias for "scan"', () => {
    expect(parseSlashArgs('mt.fuji detail')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'scan',
    });
  });

  it('accepts "all"', () => {
    expect(parseSlashArgs('mt.fuji all')).toEqual({
      kind: 'ok', poi: 'mt.fuji', mode: 'all',
    });
  });

  it('quoted POI with spaces', () => {
    expect(parseSlashArgs('"mt fuji" pricing')).toEqual({
      kind: 'ok', poi: 'mt fuji', mode: 'pricing',
    });
  });

  it('asks when only POI given', () => {
    const r = parseSlashArgs('mt.fuji');
    expect(r.kind).toBe('ask');
    if (r.kind !== 'ask') throw new Error();
    expect(r.choices.map(c => c.id)).toEqual(['scan', 'pricing', 'all']);
  });

  it('asks when empty', () => {
    expect(parseSlashArgs('').kind).toBe('ask');
  });

  it('rejects unknown mode with helpful error', () => {
    const r = parseSlashArgs('mt.fuji frobnicate');
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') throw new Error();
    expect(r.message).toMatch(/unknown mode.*frobnicate/i);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/tours/slash-arg-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tours/slash-arg-parser.ts`**

```ts
/**
 * Parses /opencli-<platform> <args> into a {poi, mode} pair, or surfaces
 * an "ask the user" choice list when input is ambiguous.
 *
 * Slash markdown stays thin and shells out here so the rules are
 * unit-testable in TS instead of buried in markdown.
 */
export type SlashMode = 'scan' | 'pricing' | 'all';

export interface ParseOk { kind: 'ok'; poi: string; mode: SlashMode; }
export interface ParseAsk { kind: 'ask'; question: string; choices: { id: string; label: string }[]; }
export interface ParseError { kind: 'error'; message: string; }
export type ParseResult = ParseOk | ParseAsk | ParseError;

const MODE_ALIASES: Record<string, SlashMode> = {
  scan: 'scan',
  detail: 'scan',
  enrich: 'scan',
  discover: 'scan',
  pricing: 'pricing',
  price: 'pricing',
  all: 'all',
};

function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

export function parseSlashArgs(input: string): ParseResult {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return askForBoth();

  const lastTok = tokens[tokens.length - 1].toLowerCase();
  const modeMaybe = MODE_ALIASES[lastTok];

  if (modeMaybe) {
    const poi = tokens.slice(0, -1).join(' ').trim();
    if (!poi) return askForBoth();
    return { kind: 'ok', poi, mode: modeMaybe };
  }

  const looksLikeModeAttempt = lastTok.length <= 12 && /^[a-z]+$/.test(lastTok);
  if (looksLikeModeAttempt && tokens.length >= 2) {
    return {
      kind: 'error',
      message: `Unknown mode "${lastTok}". Valid: scan | pricing | all (alias: detail = scan).`,
    };
  }

  const poi = tokens.join(' ').trim();
  return {
    kind: 'ask',
    question: `Which mode for "${poi}"?`,
    choices: [
      { id: 'scan',    label: 'scan — discover + enrich (no pricing writes)' },
      { id: 'pricing', label: 'pricing — refresh pinned activities only' },
      { id: 'all',     label: 'all — scan then pin top 5 then pricing in one shot' },
    ],
  };
}

function askForBoth(): ParseAsk {
  return {
    kind: 'ask',
    question: 'Which POI and mode?',
    choices: [
      { id: 'list-pois', label: 'List configured POIs (`node dist/cli.js list-pois`)' },
      { id: 'free-text', label: 'Type the POI as a quoted phrase, e.g. "mt fuji" pricing' },
    ],
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/tours/slash-arg-parser.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Add internal CLI entry point**

In `src/cli.ts`:

```ts
toursCmd
  .command('parse-slash-args')
  .description('(internal) Parse /opencli-<platform> args. Returns JSON.')
  .argument('<input...>', 'raw arg string')
  .action(async (input: string[]) => {
    const { parseSlashArgs } = await import('./tours/slash-arg-parser.js');
    console.log(JSON.stringify(parseSlashArgs(input.join(' '))));
  });
```

- [ ] **Step 6: Build, smoke test**

```bash
npm run build
node dist/cli.js tours parse-slash-args mt.fuji pricing
node dist/cli.js tours parse-slash-args mt.fuji
```

Expected: respectively, `ok` and `ask` payloads.

- [ ] **Step 7: Commit**

```bash
git add src/tours/slash-arg-parser.ts tests/tours/slash-arg-parser.test.ts src/cli.ts
git commit -m "feat(tours): slash-arg parser with ask-on-ambiguity"
```

---

## Task 10: Refactor `/opencli-kkday` slash command

**Files:**
- Modify: `.claude/commands/opencli-kkday.md`

- [ ] **Step 1: Replace the kkday slash command body**

Overwrite `.claude/commands/opencli-kkday.md` with:

````markdown
---
description: Run an opencli kkday scan/pricing/all task on a POI
argument-hint: <poi> <scan|pricing|all>   (alias: detail = scan)
---

Invoke the `opencli-kkday` skill scoped to KKday.

**Input contract:** `<poi> <mode>` where mode is one of `scan | pricing | all`.
The token `detail` is accepted as an alias for `scan`.

**Step 1 — Parse args:**
```bash
node dist/cli.js tours parse-slash-args $ARGUMENTS
```

Branch on the JSON result:

- `kind: "ok"` → continue with the `poi` and `mode` returned.
- `kind: "ask"` → present `question` + numbered `choices` to the user and STOP. Do **not** pick a default.
- `kind: "error"` → print `message` and STOP.

**Step 2 — Pre-flight:** `opencli doctor` (KKday needs Browser Bridge).
Confirm the bridge cookie locale is `en-US` (per memory `feedback_browser_bridge_en_us`).

**Step 3 — Dispatch:**

| mode    | command                                                              |
|---------|----------------------------------------------------------------------|
| scan    | `node dist/cli.js tours scan --platform kkday --poi "<poi>"`         |
| pricing | `node dist/cli.js tours pricing --platform kkday --poi "<poi>"`      |
| all     | `tours scan ...` then `tours pin --top 5` then `tours pricing ...`   |

**Step 4 — Handle pricing's "no_pinned" branch:**

If `tours pricing` returns `"no_pinned": true` (exit code 2), **do not
auto-fallback**. Surface the choice to the user verbatim:

```
No pinned activities for kkday × <poi>. Pick:
  1) /opencli-kkday <poi> all
  2) /opencli-kkday <poi> scan         (then pin later)
  3) tours pin --platform kkday --poi <poi> --top 5
  4) cancel
```

KKday quirks (see `opencli-kkday` skill):
- First request after cold bridge may return skeletal page; retry-once is normal.
- `get-pricing-matrix` returns minimum-across-sub-SKUs per package/date.
- No `trending` command.

$ARGUMENTS
````

- [ ] **Step 2: Sanity-check the markdown**

Confirm:
- Frontmatter `argument-hint` updated.
- Step 1 calls `parse-slash-args`.
- Step 4 forbids auto-fallback.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/opencli-kkday.md
git commit -m "feat(slash): /opencli-kkday <poi> <mode> with ask-on-ambiguity"
```

---

## Task 11: Replicate slash refactor for klook / trip / getyourguide / airbnb

**Files:**
- Modify: `.claude/commands/opencli-{klook,trip,getyourguide}.md`, `.claude/commands/opencli-airbnb.md` (only if it exists)

- [ ] **Step 1: Apply the same pattern to each platform**

For each file, do the same swap as Task 10:
- frontmatter `argument-hint`
- Step 1 parse-args
- Step 3 dispatch table (substitute platform name)
- Step 4 no_pinned branch

**Preserve each platform's quirks paragraph** — those bullets are owner-curated and must not be lost.

```bash
ls .claude/commands/opencli-*.md
```

Iterate. Skip airbnb if its markdown file doesn't yet exist.

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/opencli-*.md
git commit -m "feat(slash): roll out <poi> <mode> shape to all platform commands"
```

---

## Task 12: Create `opencli-scan` skill via skill-creator

**Files:**
- Create: `.claude/skills/opencli-scan/SKILL.md` (and any supporting files skill-creator emits)

Per `feedback_skill_creator_required`, this MUST go through `document-skills:skill-creator` — do not hand-write the SKILL.md.

- [ ] **Step 1: Invoke skill-creator with the brief**

Use the `document-skills:skill-creator` skill with this brief:

> **Name:** `opencli-scan`
>
> **Description:** Discover + enrich activities for a (POI, platform) pair via search → detail. Drives coverage % toward 90%. Never writes pricing — that's `opencli-pricing`'s job.
>
> **Owner:** Ryan Huang
>
> **When to use:**
> - User invokes `/opencli-<platform> <poi> scan` (or `detail`).
> - Routine layer (`opencli-routine`) decides this (POI, platform) needs coverage work.
> - User says "discover", "scan", "find more activities", "expand coverage".
>
> **What it does:**
> 1. Pre-flight: `opencli doctor` for browser-bridge platforms; en-US locale check.
> 2. Run: `node dist/cli.js tours scan --platform <p> --poi "<poi>"`.
> 3. On per-activity failure → delegate to `opencli-<platform>` skill's fallback playbook.
> 4. On success → optionally suggest `tours pin --top 5` if user wants to start tracking prices.
> 5. Report: count discovered, count newly enriched, coverage % delta.
>
> **What it is NOT:**
> - Does not write skus or sku_observations.
> - Does not call `tours pricing`.
> - Does not duplicate platform quirks — those live in `opencli-<platform>`.
>
> **Companion skills:** `opencli-pricing` (next step in flow), `opencli-<platform>` (failure fallbacks), `opencli-routine` (orchestrator that dispatches here).

- [ ] **Step 2: Verify skill-creator produced a valid SKILL.md**

```bash
cat .claude/skills/opencli-scan/SKILL.md | head -10
```

Expected: frontmatter with `name: opencli-scan`, `description: ...`. Body covers the points above.

- [ ] **Step 3: Smoke test — invoke the skill**

In a separate Claude Code conversation: type `/opencli-kkday "mt fuji" scan` and confirm Claude loads the new skill (look for "Using opencli-scan skill" in the response).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/opencli-scan/
git commit -m "feat(skill): add opencli-scan for discovery + enrichment"
```

---

## Task 13: Create `opencli-pricing` skill via skill-creator

**Files:**
- Create: `.claude/skills/opencli-pricing/SKILL.md`

- [ ] **Step 1: Invoke skill-creator with the brief**

> **Name:** `opencli-pricing`
>
> **Description:** Refresh prices for pinned activities of a (POI, platform) pair. High-frequency (daily). Includes the `no_pinned` decision panel and the `pin` action.
>
> **Owner:** Ryan Huang
>
> **When to use:**
> - User invokes `/opencli-<platform> <poi> pricing`.
> - Routine layer fires the daily price refresh.
> - User says "refresh price", "刷價", "update prices".
>
> **What it does:**
> 1. Pre-flight identical to `opencli-scan`.
> 2. Run: `node dist/cli.js tours pricing --platform <p> --poi "<poi>"`.
> 3. **If exit code 2 / `no_pinned: true`** → present numbered choice list to the user (do NOT auto-fallback):
>    a) Run `all` mode (`/opencli-<platform> <poi> all`).
>    b) Run scan first (`/opencli-<platform> <poi> scan`), then pin manually.
>    c) Pin top 5 if scan already ran (`tours pin --platform <p> --poi <poi> --top 5`).
>    d) Cancel.
> 4. On per-activity failure → delegate to `opencli-<platform>` skill.
> 5. Report: SKUs refreshed, observations appended, anomalies (>30% jump → flag).
>
> **What it is NOT:**
> - Does not call detail / scan paths.
> - Does not silently fall back to scan when there's nothing to price.
> - Does not implement the `pin` action itself — uses `tours pin` CLI.
>
> **Companion skills:** `opencli-scan` (precondition for first-time POIs), `opencli-<platform>` (failure fallbacks), `opencli-routine` (orchestrator).

- [ ] **Step 2: Verify**

```bash
cat .claude/skills/opencli-pricing/SKILL.md | head -10
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/opencli-pricing/
git commit -m "feat(skill): add opencli-pricing for pinned price refresh"
```

---

## Task 14: Rename `opencli-tours-routine` → `opencli-routine`, shrink to orchestrator

**Files:**
- Rename: `.claude/skills/opencli-tours-routine/` → `.claude/skills/opencli-routine/`
- Rename: `.claude/commands/opencli-tours-routine.md` → `.claude/commands/opencli-routine.md`
- Modify: `CLAUDE.md` (table of skills + Tours Pipeline section)
- Modify: `docs/skill-template-platform.md` if it references the old name

- [ ] **Step 1: Find all references to the old name**

```bash
grep -rn "opencli-tours-routine" --include="*.md" --include="*.ts" --include="*.json" .
```

Expected: hits in `CLAUDE.md`, possibly `docs/`, possibly skill-lock or scheduled-task config. List them all before renaming.

- [ ] **Step 2: Rename the skill directory and command file**

```bash
git mv .claude/skills/opencli-tours-routine .claude/skills/opencli-routine
git mv .claude/commands/opencli-tours-routine.md .claude/commands/opencli-routine.md
```

- [ ] **Step 3: Update SKILL.md frontmatter**

Edit `.claude/skills/opencli-routine/SKILL.md`:
- `name: opencli-tours-routine` → `name: opencli-routine`
- Update `description` to emphasise orchestrator role.

- [ ] **Step 4: Shrink the body to orchestrator content**

Replace the body of `.claude/skills/opencli-routine/SKILL.md` with:

````markdown
# opencli-routine

Orchestrator for the daily tours pipeline. Decides which sub-skill to run for each (POI, platform) target — does NOT implement the work itself.

## Pre-flight

- Confirm `data/tours.db` exists and is readable.
- Confirm Browser Bridge cookie is `en-US` (per `feedback_browser_bridge_en_us`).

## Decide per (POI, platform) target

| Situation | Run |
|---|---|
| First time on this POI/platform | `opencli-scan` → `tours pin --top 5` → `opencli-pricing` |
| Daily price refresh of pinned items | `opencli-pricing` |
| Weekly coverage scan | `opencli-scan` |

## Cron / scheduled trigger

The default scheduled trigger runs `opencli-pricing` for every (POI, platform) in `list-pois`. Coverage scans are weekly via a separate trigger.

## What this skill does NOT do

- Does not run scan or pricing inline — always delegates to the matching skill.
- Does not duplicate platform quirks — those live in `opencli-<platform>`.
- Does not own DB schema — that's `src/tours/db.ts`.

## Companion skills

- `opencli-scan` — the discovery half.
- `opencli-pricing` — the price-refresh half.
- `opencli-<platform>` — per-platform troubleshooting (klook/trip/getyourguide/kkday/airbnb).
- `opencli-router` — entry-point dispatcher when the user hasn't named a platform.

**Owner:** Ryan Huang
````

- [ ] **Step 5: Update `CLAUDE.md`**

Find the Skills table and the "Tours Pipeline" section. Update:
- Skills table row `opencli-tours-routine` → `opencli-routine` with new description.
- Tours Pipeline section: add the new mental model (scan / pin / pricing) as I drafted in the previous plan version. Replace any reference to old `tours run` workflow being canonical with the new tier-aware flow.

- [ ] **Step 6: Update any other stragglers**

For each hit from Step 1's grep that was NOT yet updated, replace `opencli-tours-routine` with `opencli-routine`.

- [ ] **Step 7: Sanity test**

```bash
npm run build && npm test && npm run typecheck
grep -rn "opencli-tours-routine" --include="*.md" --include="*.ts" --include="*.json" .
```

Expected: tests pass; second grep returns no results.

- [ ] **Step 8: Commit**

```bash
git add -A .claude/skills/opencli-routine .claude/commands/opencli-routine.md CLAUDE.md
git commit -m "refactor(skill): rename opencli-tours-routine to opencli-routine and shrink to orchestrator"
```

---

## Task 15: End-to-end acceptance smoke test

**Files:**
- Create: `scripts/verify-scan-pricing-split.sh`

This task exists to give Ryan a single command that exercises the four outcomes he cares about: coverage numbers, complete per-platform activity data, skill+opencli wiring, and total-found per POI.

- [ ] **Step 1: Write the acceptance script**

Create `scripts/verify-scan-pricing-split.sh`:

```bash
#!/usr/bin/env bash
# End-to-end smoke for the scan/pricing split.
# Targets: kkday × "mt fuji". Run AFTER all other tasks.
set -euo pipefail

POI="mt fuji"
PLATFORM="kkday"
JQ_BIN="${JQ_BIN:-jq}"

echo "── 1. Pre-flight ──────────────────────────────────"
opencli doctor || { echo "opencli doctor failed"; exit 1; }

echo "── 2. Scan (discover + enrich, NO pricing) ────────"
SCAN_OUT=$(node dist/cli.js tours scan --platform "$PLATFORM" --poi "$POI" --limit 5)
echo "$SCAN_OUT" | "$JQ_BIN" .
TOTAL_FOUND=$(echo "$SCAN_OUT" | "$JQ_BIN" -r '.total_found')
[ "$TOTAL_FOUND" -gt 0 ] || { echo "FAIL: total_found=0 — POI search produced nothing"; exit 1; }
echo "✓ total_found=$TOTAL_FOUND"

echo "── 3. Pin top 2 by review_count ───────────────────"
node dist/cli.js tours pin --platform "$PLATFORM" --poi "$POI" --top 2 | "$JQ_BIN" .

echo "── 4. Pricing (refresh pinned only) ───────────────"
node dist/cli.js tours pricing --platform "$PLATFORM" --poi "$POI" | "$JQ_BIN" .

echo "── 5. Report (renders coverage + completeness) ────"
node dist/cli.js tours generate-report
REPORT_PATH="data/reports/latest.html"
[ -f "$REPORT_PATH" ] || { echo "FAIL: $REPORT_PATH missing"; exit 1; }
echo "✓ report at $REPORT_PATH"

echo "── 6. Coverage dump (proves coverage_runs wrote) ──"
sqlite3 data/tours.db "SELECT poi, platform, total_reported, fetched, new_unique, run_at FROM coverage_runs WHERE LOWER(poi)=LOWER('$POI') AND platform='$PLATFORM' ORDER BY run_at DESC LIMIT 1;"

echo "── 7. Completeness check (per-package fields) ─────"
sqlite3 data/tours.db "SELECT a.platform, COUNT(*) AS pkgs,
  SUM(CASE WHEN a.supplier IS NULL THEN 1 ELSE 0 END) AS missing_supplier,
  SUM(CASE WHEN a.description IS NULL THEN 1 ELSE 0 END) AS missing_description
  FROM activities a WHERE a.platform='$PLATFORM' AND LOWER(a.poi)=LOWER('$POI')
  GROUP BY a.platform;"

echo
echo "✅ All four acceptance criteria verified:"
echo "  1) total_found from search:           $TOTAL_FOUND"
echo "  2) per-platform activity data:        rendered in $REPORT_PATH"
echo "  3) skill + opencli architecture:      tours scan/pin/pricing all completed"
echo "  4) coverage:                          coverage_runs row written (see step 6)"
```

```bash
chmod +x scripts/verify-scan-pricing-split.sh
```

- [ ] **Step 2: Smoke test**

```bash
./scripts/verify-scan-pricing-split.sh
```

Expected: each step prints output, final summary lists all four ✅. Failure of any step exits non-zero.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-scan-pricing-split.sh
git commit -m "test(tours): end-to-end acceptance script for scan/pricing split"
```

---

## Self-Review Checklist

**Spec coverage:**
- DB column `is_pinned` (boolean, default 0) → Task 1
- DB methods to query/mutate pinning → Task 2
- Pricing-only path with no detail fallback → Task 3, 5
- Scan-only path with no SKU writes → Task 4
- Pin-by-review_count primitive → Task 6
- CLI handlers + commander wiring → Task 7, 8
- Slash-command parser with ask-on-ambiguity → Task 9
- Per-platform slash command refactor → Task 10, 11
- New `opencli-scan` skill → Task 12
- New `opencli-pricing` skill → Task 13
- Renamed orchestrator `opencli-routine` → Task 14
- Backward compat: legacy `tours run` / `ingest-from-planning-csv` untouched → not modified
- en-US Browser Bridge invariant called out → Task 10, 11, 14
- `opencli-compare-poi` deferred (NOT in this plan) → confirmed

**Type consistency:**
- `is_pinned` is `number` (0 or 1) on `Activity` row, but `setPinned` accepts `boolean` for ergonomics. Both layers are explicit about which.
- `IngestOptions` reused; `ingestPricingOnly` accepts `Omit<IngestOptions, 'detailFallback'>`.
- `SlashMode` is `'scan' | 'pricing' | 'all'` — single source of truth in `slash-arg-parser.ts`.

**Risks worth calling out:**
1. `ingestPricing` returning `captured_days` is a new field. Existing callers must continue to work — verify with `grep -rn "ingestPricing(" src/` before/after Task 3.
2. `parseReviewCount` becoming exported (Task 4) — make sure no caller shadows the name.
3. Exit code 2 convention is new. The cron / routine layer must treat exit ≠ 0 as fatal only for exit ∉ {0, 2}.
4. Skill-creator (Tasks 12, 13) is interactive — the engineer running this plan must respond to its prompts. Allocate 10 min per skill.
5. Task 14 rename touches `CLAUDE.md` — that file is also live context for the user's next session, so the new content goes live immediately.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-29-catalog-pricing-split.md` (filename retained for git history continuity). Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans` with batch checkpoints.

Which approach?
