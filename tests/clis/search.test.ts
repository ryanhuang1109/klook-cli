import { describe, it, expect } from 'vitest';
import { buildSearchEvaluate, __test__ } from '../../src/clis/klook/search.js';

describe('klook/search', () => {
  describe('buildSearchEvaluate', () => {
    it('returns a string containing the query and limit', () => {
      const js = buildSearchEvaluate('tokyo tickets', 10);
      expect(js).toContain('tokyo tickets');
      expect(js).toContain('10');
    });

    it('escapes special characters in query', () => {
      const js = buildSearchEvaluate('it\'s "great"', 5);
      expect(js).toContain("it's");
      expect(js).toContain('\\"great\\"');
    });
  });

  describe('clampLimit', () => {
    it('clamps to range [1, 50]', () => {
      expect(__test__.clampLimit(0)).toBe(1);
      expect(__test__.clampLimit(25)).toBe(25);
      expect(__test__.clampLimit(100)).toBe(50);
      expect(__test__.clampLimit(NaN)).toBe(20);
    });
  });
});
