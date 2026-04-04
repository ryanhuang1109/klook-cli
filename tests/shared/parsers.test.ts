import { describe, it, expect } from 'vitest';
import { parseSearchResults, parseTrendingResults, parseActivityDetail } from '../../src/shared/parsers.js';

describe('parseSearchResults', () => {
  it('extracts activities from structured search data', () => {
    const raw = [
      {
        title: 'Tokyo Disneyland Ticket',
        price: '2,400',
        currency: 'TWD',
        starScore: '4.8',
        reviewCount: '15234',
        categoryName: 'Theme Parks',
        cityName: 'Tokyo',
        deeplink: '/activity/1234-tokyo-disneyland/',
      },
      {
        title: 'Mt. Fuji Day Tour',
        price: '3,100',
        currency: 'TWD',
        starScore: '4.7',
        reviewCount: '8921',
        categoryName: 'Tours',
        cityName: 'Tokyo',
        deeplink: '/activity/5678-mt-fuji/',
      },
    ];
    const result = parseSearchResults(raw, 10);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      rank: 1,
      title: 'Tokyo Disneyland Ticket',
      price: '2,400',
      currency: 'TWD',
      rating: '4.8',
      review_count: '15234',
      category: 'Theme Parks',
      city: 'Tokyo',
      url: 'https://www.klook.com/activity/1234-tokyo-disneyland/',
    });
    expect(result[1].rank).toBe(2);
  });

  it('respects limit', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      title: `Activity ${i}`,
      price: '100',
      currency: 'TWD',
      starScore: '4.0',
      reviewCount: '10',
      categoryName: 'Tours',
      cityName: 'Tokyo',
      deeplink: `/activity/${i}/`,
    }));
    const result = parseSearchResults(raw, 5);
    expect(result).toHaveLength(5);
  });

  it('returns empty array for empty input', () => {
    expect(parseSearchResults([], 10)).toEqual([]);
    expect(parseSearchResults(null as any, 10)).toEqual([]);
  });
});

describe('parseTrendingResults', () => {
  it('extracts trending activities', () => {
    const raw = [
      {
        title: 'Osaka Castle',
        price: '600',
        currency: 'TWD',
        starScore: '4.6',
        reviewCount: '3200',
        categoryName: 'Attractions',
        deeplink: '/activity/9999-osaka-castle/',
      },
    ];
    const result = parseTrendingResults(raw, 10);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Osaka Castle');
    expect(result[0].rank).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseTrendingResults([], 10)).toEqual([]);
    expect(parseTrendingResults(null as any, 10)).toEqual([]);
  });
});

describe('parseActivityDetail', () => {
  it('extracts full detail with packages', () => {
    const raw = {
      title: 'Tokyo Disneyland Ticket',
      description: 'Visit the magical kingdom...',
      cityName: 'Tokyo',
      categoryName: 'Theme Parks',
      starScore: '4.8',
      reviewCount: '15234',
      images: ['https://img.klook.com/a.jpg', 'https://img.klook.com/b.jpg'],
      itinerary: [
        { time: '09:00', title: 'Park Opens', description: 'Enter the park' },
      ],
      packages: [
        {
          name: '1-Day Passport',
          description: 'Full day access',
          inclusions: ['Park entry', 'All rides'],
          exclusions: ['Food', 'Merchandise'],
          price: '2,400',
          currency: 'TWD',
          originalPrice: '2,800',
          discount: '14% off',
          date: '2026-05-01',
          availability: 'Available',
        },
      ],
      url: 'https://www.klook.com/activity/1234/',
    };
    const result = parseActivityDetail(raw);
    expect(result.title).toBe('Tokyo Disneyland Ticket');
    expect(result.images).toHaveLength(2);
    expect(result.itinerary).toHaveLength(1);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('1-Day Passport');
    expect(result.packages[0].original_price).toBe('2,800');
  });

  it('handles missing optional fields gracefully', () => {
    const raw = {
      title: 'Some Activity',
      description: '',
      cityName: '',
      categoryName: '',
      starScore: '',
      reviewCount: '',
      images: [],
      itinerary: [],
      packages: [],
      url: 'https://www.klook.com/activity/1/',
    };
    const result = parseActivityDetail(raw);
    expect(result.title).toBe('Some Activity');
    expect(result.itinerary).toEqual([]);
    expect(result.packages).toEqual([]);
  });

  it('handles truly absent fields', () => {
    const raw = { title: 'Minimal', url: 'https://www.klook.com/activity/2/' };
    const result = parseActivityDetail(raw);
    expect(result.title).toBe('Minimal');
    expect(result.description).toBe('');
    expect(result.images).toEqual([]);
    expect(result.itinerary).toEqual([]);
    expect(result.packages).toEqual([]);
  });
});
