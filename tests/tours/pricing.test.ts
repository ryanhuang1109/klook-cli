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
