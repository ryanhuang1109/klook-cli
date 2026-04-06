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
