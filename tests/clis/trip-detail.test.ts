import { describe, it, expect } from 'vitest';
import { __test__ } from '../../src/clis/trip/detail.js';

describe('trip/detail', () => {
  describe('parseActivityId', () => {
    it('extracts numeric ID from plain number', () => {
      expect(__test__.parseActivityId('92795279')).toBe('92795279');
    });

    it('extracts ID from full URL', () => {
      expect(__test__.parseActivityId('https://www.trip.com/things-to-do/detail/92795279/')).toBe('92795279');
    });

    it('extracts ID from partial path', () => {
      expect(__test__.parseActivityId('/things-to-do/detail/12345/')).toBe('12345');
    });

    it('returns input if no pattern matches', () => {
      expect(__test__.parseActivityId('some-slug')).toBe('some-slug');
    });
  });
});
