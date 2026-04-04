import { describe, it, expect } from 'vitest';
import { buildTrendingEvaluate, __test__ } from '../../src/clis/klook/trending.js';

describe('klook/trending', () => {
  describe('buildTrendingEvaluate', () => {
    it('returns a string containing the limit', () => {
      const js = buildTrendingEvaluate(15);
      expect(js).toContain('15');
    });
  });

  describe('normalizeCitySlug', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(__test__.normalizeCitySlug('New York')).toBe('new-york');
      expect(__test__.normalizeCitySlug('tokyo')).toBe('tokyo');
      expect(__test__.normalizeCitySlug('Hong Kong')).toBe('hong-kong');
    });
  });
});
