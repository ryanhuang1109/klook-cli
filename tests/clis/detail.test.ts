import { describe, it, expect } from 'vitest';
import { buildDetailEvaluate, __test__ } from '../../src/clis/klook/detail.js';

describe('klook/detail', () => {
  describe('buildDetailEvaluate', () => {
    it('returns evaluate script', () => {
      const js = buildDetailEvaluate();
      expect(typeof js).toBe('string');
      expect(js).toContain('title');
      expect(js).toContain('packages');
    });
  });

  describe('parseActivityId', () => {
    it('extracts numeric ID from plain number', () => {
      expect(__test__.parseActivityId('1234')).toBe('1234');
    });

    it('extracts ID from full URL', () => {
      expect(__test__.parseActivityId('https://www.klook.com/activity/1234-tokyo-disneyland/')).toBe('1234');
    });

    it('extracts ID from partial path', () => {
      expect(__test__.parseActivityId('/activity/5678-mt-fuji/')).toBe('5678');
    });

    it('returns input if no pattern matches', () => {
      expect(__test__.parseActivityId('some-slug')).toBe('some-slug');
    });
  });
});
