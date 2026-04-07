import type { ActivitySection, KlookActivity, KlookDetail, KlookItineraryStep, KlookPackage } from './types.js';

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function toKlookUrl(deeplink: string): string {
  if (!deeplink) return '';
  if (deeplink.startsWith('http')) return deeplink;
  return `https://www.klook.com${deeplink.startsWith('/') ? '' : '/'}${deeplink}`;
}

export function parseSearchResults(raw: unknown[], limit: number): KlookActivity[] {
  if (!Array.isArray(raw)) return [];
  if (limit <= 0) return [];
  return raw
    .filter((item: any) => str(item.title))
    .slice(0, limit)
    .map((item: any, index: number) => ({
      rank: index + 1,
      title: str(item.title),
      price: str(item.price),
      currency: str(item.currency),
      rating: str(item.starScore),
      review_count: str(item.reviewCount),
      category: str(item.categoryName),
      city: str(item.cityName),
      url: toKlookUrl(str(item.deeplink)),
    }));
}

export function parseTrendingResults(raw: unknown[], limit: number): KlookActivity[] {
  if (!Array.isArray(raw)) return [];
  if (limit <= 0) return [];
  return raw
    .filter((item: any) => str(item.title))
    .slice(0, limit)
    .map((item: any, index: number) => ({
      rank: index + 1,
      title: str(item.title),
      price: str(item.price),
      currency: str(item.currency),
      rating: str(item.starScore),
      review_count: str(item.reviewCount),
      category: str(item.categoryName),
      city: str(item.cityName ?? ''),
      url: toKlookUrl(str(item.deeplink)),
    }));
}

export function parseActivityDetail(raw: unknown): KlookDetail {
  if (raw == null || typeof raw !== 'object') {
    return { title: '', description: '', city: '', category: '', rating: '', review_count: '', images: [], itinerary: [], packages: [], sections: [], url: '' };
  }
  const r = raw as Record<string, unknown>;

  const itinerary: KlookItineraryStep[] = Array.isArray(r.itinerary)
    ? r.itinerary.map((step: any) => ({
        time: str(step.time),
        title: str(step.title),
        description: str(step.description),
      }))
    : [];

  const packages: KlookPackage[] = Array.isArray(r.packages)
    ? r.packages.map((pkg: any) => ({
        name: str(pkg.name),
        description: str(pkg.description),
        inclusions: Array.isArray(pkg.inclusions) ? pkg.inclusions.map(str) : [],
        exclusions: Array.isArray(pkg.exclusions) ? pkg.exclusions.map(str) : [],
        price: str(pkg.price),
        currency: str(pkg.currency),
        original_price: str(pkg.originalPrice),
        discount: str(pkg.discount),
        date: str(pkg.date),
        availability: str(pkg.availability),
      }))
    : [];

  const sections: ActivitySection[] = Array.isArray(r.sections)
    ? r.sections.map((s: any) => ({
        title: str(s.title ?? s.standard),
        original_title: str(s.original_title ?? s.original),
        content: str(s.content),
      })).filter((s: ActivitySection) => s.content)
    : [];

  return {
    title: str(r.title),
    description: str(r.description),
    city: str(r.cityName),
    category: str(r.categoryName),
    rating: str(r.starScore),
    review_count: str(r.reviewCount),
    images: Array.isArray(r.images) ? r.images.map(str).filter(Boolean) : [],
    itinerary,
    packages,
    sections,
    url: str(r.url),
  };
}
