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
