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
