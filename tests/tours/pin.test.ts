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

  const mk = (db: any, n: number, reviews: number | null) =>
    db.upsertActivity({
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

  it('pins top-N by review_count, leaves the rest un-pinned', async () => {
    const db = await openDB(dbPath);
    mk(db, 1, 1000); mk(db, 2, 500); mk(db, 3, 200); mk(db, 4, 50);

    const r = await pinTopByReviews(db, {
      platform: 'kkday', poi: 'mt fuji', top: 2,
    });

    expect(r.pinned.map((a) => a.id).sort()).toEqual(['kkday:1', 'kkday:2']);
    const flags = Object.fromEntries(
      db.listActivities().map((a: any) => [a.id, a.is_pinned]),
    );
    expect(flags).toEqual({
      'kkday:1': 1, 'kkday:2': 1,
      'kkday:3': 0, 'kkday:4': 0,
    });
  });

  it('idempotent: re-running with smaller top does not un-pin', async () => {
    const db = await openDB(dbPath);
    mk(db, 1, 1000); mk(db, 2, 500); mk(db, 3, 200); mk(db, 4, 50);

    await pinTopByReviews(db, { platform: 'kkday', poi: 'mt fuji', top: 2 });
    await pinTopByReviews(db, { platform: 'kkday', poi: 'mt fuji', top: 1 });

    const flags = Object.fromEntries(
      db.listActivities().map((a: any) => [a.id, a.is_pinned]),
    );
    // Both still pinned — pin only flips 0→1, never 1→0
    expect(flags['kkday:1']).toBe(1);
    expect(flags['kkday:2']).toBe(1);
    expect(flags['kkday:3']).toBe(0);
    expect(flags['kkday:4']).toBe(0);
  });

  it('handles null review_count by sorting them last', async () => {
    const db = await openDB(dbPath);
    mk(db, 1, null); mk(db, 2, 100); mk(db, 3, 200);

    const r = await pinTopByReviews(db, {
      platform: 'kkday', poi: 'mt fuji', top: 2,
    });

    // Top 2 by review_count: 200 (id 3), 100 (id 2). Null (id 1) excluded.
    expect(r.pinned.map((a) => a.id).sort()).toEqual(['kkday:2', 'kkday:3']);
  });

  it('considered count includes everything in (POI, platform), not just winners', async () => {
    const db = await openDB(dbPath);
    mk(db, 1, 100); mk(db, 2, 50); mk(db, 3, 25);

    const r = await pinTopByReviews(db, {
      platform: 'kkday', poi: 'mt fuji', top: 1,
    });

    expect(r.considered).toBe(3);
    expect(r.pinned).toHaveLength(1);
  });
});
