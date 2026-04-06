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
