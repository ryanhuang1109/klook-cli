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
    expect(pinned.map((a) => a.id).sort()).toEqual(['kkday:1', 'kkday:2']);
  });

  it('setPinned(false) un-pins', async () => {
    const db = await openDB(dbPath);
    db.upsertActivity({
      id: 'kkday:1', platform: 'kkday', platform_product_id: '1',
      canonical_url: 'https://www.kkday.com/en/product/1',
      title: 'A', supplier: null, poi: 'mt fuji',
      duration_minutes: null, departure_city: null,
      rating: null, review_count: 100, order_count: null,
      description: null, cancellation_policy: null,
      raw_extras_json: '{}',
      first_scraped_at: '2026-04-29T00:00:00Z',
      last_scraped_at: '2026-04-29T00:00:00Z',
      review_status: 'unverified', review_note: null,
    });
    db.setPinned('kkday:1', true);
    db.setPinned('kkday:1', false);
    expect(db.listPinnedActivities()).toEqual([]);
  });

  it('listPinnedActivities orders by review_count DESC NULLS LAST', async () => {
    const db = await openDB(dbPath);
    const mk = (id: string, reviews: number | null): any => ({
      id, platform: 'kkday', platform_product_id: id.split(':')[1],
      canonical_url: `https://www.kkday.com/en/product/${id.split(':')[1]}`,
      title: id, supplier: null, poi: 'mt fuji',
      duration_minutes: null, departure_city: null,
      rating: null, review_count: reviews, order_count: null,
      description: null, cancellation_policy: null,
      raw_extras_json: '{}',
      first_scraped_at: '2026-04-29T00:00:00Z',
      last_scraped_at: '2026-04-29T00:00:00Z',
      review_status: 'unverified', review_note: null,
    });
    db.upsertActivity(mk('kkday:lo', 50));
    db.upsertActivity(mk('kkday:hi', 1000));
    db.upsertActivity(mk('kkday:none', null));
    db.setPinned('kkday:lo', true);
    db.setPinned('kkday:hi', true);
    db.setPinned('kkday:none', true);

    const pinned = db.listPinnedActivities();
    expect(pinned.map((a) => a.id)).toEqual(['kkday:hi', 'kkday:lo', 'kkday:none']);
  });

  it('migration adds the column when opening a DB created without it', async () => {
    // Build a legacy DB (using sql.js directly) that has the activities table
    // but WITHOUT is_pinned — exactly as it existed before the migration was added.
    const sqljs = await import('sql.js');
    const initSqlJs = (sqljs as any).default;
    const SQL = await initSqlJs();
    const legacyDb = new SQL.Database();
    legacyDb.run(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_product_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        supplier TEXT,
        poi TEXT,
        duration_minutes INTEGER,
        departure_city TEXT,
        rating REAL,
        review_count INTEGER,
        order_count INTEGER,
        description TEXT,
        cancellation_policy TEXT,
        raw_extras_json TEXT NOT NULL DEFAULT '{}',
        first_scraped_at TEXT NOT NULL,
        last_scraped_at TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'unverified',
        review_note TEXT
        -- no is_pinned column
      );
    `);

    // Sanity-check: legacy DB really lacks is_pinned.
    const stmt = legacyDb.prepare(`PRAGMA table_info(activities)`);
    const legacyCols: string[] = [];
    while (stmt.step()) legacyCols.push((stmt.getAsObject() as any).name);
    stmt.free();
    expect(legacyCols).not.toContain('is_pinned');

    // Persist to the temp path our openDB() will read.
    const fs = await import('node:fs');
    fs.writeFileSync(dbPath, Buffer.from(legacyDb.export()));
    legacyDb.close();

    // Open via production openDB — migration block should ALTER TABLE ADD COLUMN.
    const db2 = await openDB(dbPath);
    expect(db2.rawColumns('activities')).toContain('is_pinned');
    db2.close();
  });
});
