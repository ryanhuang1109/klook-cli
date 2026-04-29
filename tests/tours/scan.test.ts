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
    expect(r.total_found).toBe(2);
    expect(r.succeeded).toBe(2);
  });

  it('ranks hits by review_count desc when sortBy=reviews (default)', async () => {
    vi.spyOn(ingest, 'runSearch').mockReturnValue([
      { title: 'low', url: 'https://www.kkday.com/en/product/1', review_count: '50' },
      { title: 'high', url: 'https://www.kkday.com/en/product/2', review_count: '1000' },
      { title: 'mid', url: 'https://www.kkday.com/en/product/3', review_count: '500' },
    ] as any);

    const detailCalls: { activityId: string }[] = [];
    vi.spyOn(ingest, 'ingestFromDetail').mockImplementation(async (db, opts) => {
      detailCalls.push({ activityId: opts.activityId });
      return {} as any;
    });

    const fakeDb: any = { logSearchRun: vi.fn() };

    await runScan(fakeDb, {
      platform: 'kkday', poi: 'mt fuji', keyword: 'mt fuji', limit: 2,
    });

    // Top 2 by reviews: 1000 (id 2), 500 (id 3) — id 1 (50 reviews) excluded.
    expect(detailCalls.map((c) => c.activityId)).toEqual(['2', '3']);
  });

  it('records failures when activity id cannot be extracted', async () => {
    vi.spyOn(ingest, 'runSearch').mockReturnValue([
      { title: 'good', url: 'https://www.kkday.com/en/product/1', review_count: '10' },
      { title: 'bad', url: 'https://example.com/no-id-here', review_count: '5' },
    ] as any);
    vi.spyOn(ingest, 'ingestFromDetail').mockResolvedValue({} as any);

    const fakeDb: any = { logSearchRun: vi.fn() };

    const r = await runScan(fakeDb, {
      platform: 'kkday', poi: 'mt fuji', keyword: 'mt fuji', limit: 5,
    });

    expect(r.succeeded).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toBe('id-not-extractable');
  });

  it('writes a search_runs log row', async () => {
    vi.spyOn(ingest, 'runSearch').mockReturnValue([
      { title: 'A', url: 'https://www.kkday.com/en/product/1', review_count: '10' },
    ] as any);
    vi.spyOn(ingest, 'ingestFromDetail').mockResolvedValue({} as any);

    const logSearchRun = vi.fn();
    const fakeDb: any = { logSearchRun };

    await runScan(fakeDb, {
      platform: 'kkday', poi: 'mt fuji', keyword: 'mt fuji', limit: 5,
    });

    expect(logSearchRun).toHaveBeenCalledOnce();
    const call = logSearchRun.mock.calls[0][0];
    expect(call.platform).toBe('kkday');
    expect(call.poi).toBe('mt fuji');
    expect(call.keyword).toBe('mt fuji');
    expect(call.total_found).toBe(1);
    expect(call.ingested).toBe(1);
    expect(call.succeeded).toBe(1);
  });
});
