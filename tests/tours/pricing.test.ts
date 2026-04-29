import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ingest from '../../src/tours/ingest.js';

describe('ingestPricingOnly', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does NOT call ingestFromDetail even when pricing returns 0 days', async () => {
    vi.spyOn(ingest, 'runPricingRaw').mockReturnValue({
      activity_id: '2247',
      ota: 'kkday',
      url: '',
      title: '',
      days_requested: 7,
      days_captured: 0,
      rows: [],
      errors: [],
    } as any);
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');

    const fakeDb: any = {
      upsertActivity: vi.fn(() => true),
      upsertPackage: vi.fn(() => true),
      upsertSKU: vi.fn(() => true),
      appendObservation: vi.fn(() => true),
      logExecution: vi.fn(),
      getActivity: vi.fn(() => null),
      getPackage: vi.fn(() => null),
      listPackagesForActivity: vi.fn(() => []),
    };

    const r = await ingest.ingestPricingOnly(fakeDb, {
      platform: 'kkday', activityId: '2247', poi: 'mt fuji',
    });

    expect(detailSpy).not.toHaveBeenCalled();
    expect(r.captured_days).toBe(0);
    expect(r.skus_written).toBe(0);
  });

  it('returns captured_days from raw.days_captured', async () => {
    vi.spyOn(ingest, 'runPricingRaw').mockReturnValue({
      activity_id: '2247',
      ota: 'kkday',
      url: '',
      title: '',
      days_requested: 7,
      days_captured: 7,
      rows: [],
      errors: [],
    } as any);
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');

    const fakeDb: any = {
      upsertActivity: vi.fn(() => true),
      upsertPackage: vi.fn(() => true),
      upsertSKU: vi.fn(() => true),
      appendObservation: vi.fn(() => true),
      logExecution: vi.fn(),
      getActivity: vi.fn(() => null),
      getPackage: vi.fn(() => null),
      listPackagesForActivity: vi.fn(() => []),
    };

    const r = await ingest.ingestPricingOnly(fakeDb, {
      platform: 'kkday', activityId: '2247', poi: 'mt fuji',
    });

    expect(detailSpy).not.toHaveBeenCalled();
    expect(r.captured_days).toBe(7);
  });

  it('lets runPricingRaw exceptions bubble up (no detail fallback)', async () => {
    vi.spyOn(ingest, 'runPricingRaw').mockImplementation(() => {
      throw new Error('opencli pricing returned no rows for 2247');
    });
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');

    const fakeDb: any = {};
    await expect(
      ingest.ingestPricingOnly(fakeDb, {
        platform: 'kkday', activityId: '2247', poi: 'mt fuji',
      }),
    ).rejects.toThrow('opencli pricing returned no rows');
    expect(detailSpy).not.toHaveBeenCalled();
  });
});

describe('ingestPricing (with fallback semantics)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back to ingestFromDetail when captured_days is 0 and detailFallback is not false', async () => {
    vi.spyOn(ingest, 'runPricingRaw').mockReturnValue({
      activity_id: '2247',
      ota: 'kkday', url: '', title: '',
      days_requested: 7, days_captured: 0,
      rows: [], errors: [],
    } as any);
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail').mockResolvedValue({
      activityId: '2247', platform: 'kkday',
      skus_written: 1, packages_written: 1,
      observations_appended: 1, activity_written: true,
      warnings: [], snapshot_path: '/tmp/x',
    } as any);

    const fakeDb: any = {
      upsertActivity: vi.fn(() => true),
      upsertPackage: vi.fn(() => true),
      upsertSKU: vi.fn(() => true),
      appendObservation: vi.fn(() => true),
      logExecution: vi.fn(),
      getActivity: vi.fn(() => null),
      getPackage: vi.fn(() => null),
      listPackagesForActivity: vi.fn(() => []),
    };

    const r = await ingest.ingestPricing(fakeDb, {
      platform: 'kkday', activityId: '2247', poi: 'mt fuji',
    });

    expect(detailSpy).toHaveBeenCalledOnce();
    expect(r.warnings.some((w) => w.includes('auto-fallback'))).toBe(true);
  });

  it('does NOT fall back when detailFallback is explicitly false', async () => {
    vi.spyOn(ingest, 'runPricingRaw').mockReturnValue({
      activity_id: '2247',
      ota: 'kkday', url: '', title: '',
      days_requested: 7, days_captured: 0,
      rows: [], errors: [],
    } as any);
    const detailSpy = vi.spyOn(ingest, 'ingestFromDetail');

    const fakeDb: any = {
      upsertActivity: vi.fn(() => true),
      upsertPackage: vi.fn(() => true),
      upsertSKU: vi.fn(() => true),
      appendObservation: vi.fn(() => true),
      logExecution: vi.fn(),
      getActivity: vi.fn(() => null),
      getPackage: vi.fn(() => null),
      listPackagesForActivity: vi.fn(() => []),
    };

    const r = await ingest.ingestPricing(fakeDb, {
      platform: 'kkday', activityId: '2247', poi: 'mt fuji',
      detailFallback: false,
    });

    expect(detailSpy).not.toHaveBeenCalled();
    expect(r.captured_days).toBe(0);
    expect(r.skus_written).toBe(0);
  });
});

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
          canonical_url: 'https://www.kkday.com/en/product/1',
          poi: 'mt fuji', title: 'A' },
        { id: 'kkday:2', platform: 'kkday', platform_product_id: '2',
          canonical_url: 'https://www.kkday.com/en/product/2',
          poi: 'mt fuji', title: 'B' },
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
    expect(r.succeeded).toBe(2);
  });

  it('returns { no_pinned: true } when DB has zero pinned rows', async () => {
    const fakeDb: any = { listPinnedActivities: vi.fn().mockReturnValue([]) };
    const r = await repricePinned(fakeDb, { platform: 'kkday', poi: 'mt fuji' });
    expect(r.no_pinned).toBe(true);
    expect(r.attempted).toBe(0);
    expect(r.succeeded).toBe(0);
  });

  it('records per-activity failures and continues iterating', async () => {
    let calls = 0;
    vi.spyOn(ingest, 'ingestPricingOnly').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('opencli pricing returned no rows');
      return { captured_days: 7, skus_written: 3 } as any;
    });

    const fakeDb: any = {
      listPinnedActivities: vi.fn().mockReturnValue([
        { id: 'kkday:1', platform: 'kkday', platform_product_id: '1',
          canonical_url: 'x', poi: 'mt fuji', title: 'A' },
        { id: 'kkday:2', platform: 'kkday', platform_product_id: '2',
          canonical_url: 'y', poi: 'mt fuji', title: 'B' },
      ]),
    };

    const r = await repricePinned(fakeDb, { platform: 'kkday', poi: 'mt fuji' });

    expect(calls).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.succeeded).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('kkday:1');
  });
});
