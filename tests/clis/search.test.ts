import { describe, it, expect } from 'vitest';
import { __test__ } from '../../src/clis/klook/search.js';

describe('klook/search', () => {
  describe('clampLimit', () => {
    it('clamps to range [1, 200] (was 50 before scroll-pagination)', () => {
      expect(__test__.clampLimit(0)).toBe(1);
      expect(__test__.clampLimit(25)).toBe(25);
      expect(__test__.clampLimit(100)).toBe(100);
      expect(__test__.clampLimit(500)).toBe(200);
      expect(__test__.clampLimit(NaN)).toBe(20);
    });
  });

  describe('mapSort', () => {
    it('maps CLI sort options to Klook API values', () => {
      expect(__test__.mapSort('price')).toBe('price');
      expect(__test__.mapSort('rating')).toBe('review_score');
      expect(__test__.mapSort('popular')).toBe('participants');
      expect(__test__.mapSort(undefined)).toBe('most_relevant');
    });
  });

  describe('mapCard', () => {
    it('extracts fields from Klook API card format', () => {
      const card = {
        data: {
          title: 'Tokyo Disneyland Ticket',
          price: { selling_price: 'HK$ 450' },
          review_obj: { star: '4.8', count: '93.8K+ reviews' },
          category: 'Theme parks',
          city_name: 'Tokyo',
          deep_link: 'https://www.klook.com/en-US/activity/695-tokyo-disney/',
        },
      };
      const result = __test__.mapCard(card);
      expect(result.title).toBe('Tokyo Disneyland Ticket');
      expect(result.price).toBe('HK$ 450');
      expect(result.starScore).toBe('4.8');
      expect(result.reviewCount).toBe('93.8K+ reviews');
      expect(result.categoryName).toBe('Theme parks');
      expect(result.cityName).toBe('Tokyo');
      expect(result.deeplink).toBe('https://www.klook.com/en-US/activity/695-tokyo-disney/');
    });

    it('handles missing data gracefully', () => {
      expect(__test__.mapCard(null)).toEqual({});
      expect(__test__.mapCard({ data: null })).toEqual({});
    });
  });
});
