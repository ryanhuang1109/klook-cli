import type { ActivitySection, KlookActivity, KlookDetail, KlookItineraryStep, KlookPackage } from './types.js';

function str(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function extractCancellationPolicy(rawField: unknown, sections: ActivitySection[]): string {
  const fromField = str(rawField);
  if (fromField) return fromField;
  // Stop tokens: where the cancellation chunk visually ends. Platforms concatenate
  // sub-sections without whitespace separators, so we anchor on common siblings.
  const stopRe = /(Reschedule[\s\w]*policy|How to use|Voucher (?:type|validity|period)|Notice|Important note|FAQ|Before you book|Pick-up|Confirmation\b|Reserve now|Duration\s*[:\s]*\d|Check availability|Live tour guide|Highlighted reviews|About this activity|Includes\/Excludes|Includes:|Excludes:|Itinerary|Meeting Point|Package Description|Validity Period|Reminders|Policy Info|You might also like)/;
  const patterns: RegExp[] = [
    /(?:Cancellation|Refund)\s+policy[:\s]*([\s\S]+)/i,
    /(Free\s+cancellation[\s\S]+)/i,
    /(Cancel\s+up\s+to\s+\d+\s+(?:hour|day|business day)[\s\S]+)/i,
    /(Non[-\s]?refundable[\s\S]+)/i,
    /(No\s+(?:cancell?ation|refund)s?[\s\S]+)/i,
  ];
  // Prefer the section explicitly tagged "Cancellation policy" by section-map, then fall
  // back to scanning everything. Even on the direct match we run pattern-narrowing because
  // some platforms (KKday) over-capture via .closest('section') and the standardized
  // section can hold the entire page.
  const direct = sections.find((s) => s.title === 'Cancellation policy');
  const ordered = direct
    ? [direct, ...sections.filter((s) => s !== direct)]
    : sections;
  for (const s of ordered) {
    for (const re of patterns) {
      const m = s.content.match(re);
      if (!m) continue;
      let chunk = m[1];
      const stop = chunk.match(stopRe);
      if (stop && stop.index !== undefined) chunk = chunk.slice(0, stop.index);
      chunk = chunk.trim();
      if (chunk.length >= 20) return chunk.slice(0, 2000);
    }
  }
  // Last resort: if the direct section is short enough to be the actual policy, use it
  if (direct?.content && direct.content.length > 20 && direct.content.length < 800) {
    return direct.content;
  }
  return '';
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
    // Extra header-scoped fields (optional — downstream normalize layer consumes them):
    order_count: str(r.bookCount),
    badges: Array.isArray(r.badges) ? (r.badges as unknown[]).map(str).filter(Boolean) : [],
    languages_header: str(r.languagesHeader),
    tour_type_tag: str(r.tourTypeTag),
    meeting_tag: str(r.meetingTag),
    supplier: str(r.supplier),
    // Optional clickable link to the supplier's profile page (today only
    // populated by the airbnb adapter from <a href="/users/profile/...">).
    // Other adapters can populate this when their host badge has a link.
    supplier_url: str(r.supplierUrl),
    // Dropdowns / tabs in the booking widget that represent package-variant axes
    option_dimensions: Array.isArray(r.option_dimensions) ? r.option_dimensions : [],
    // Cancellation policy: prefer explicit field from the scraper, otherwise the standardized
    // section, otherwise a substring scan inside other sections (Klook embeds the policy
    // inside "Terms & Conditions" without a heading break).
    cancellation_policy: extractCancellationPolicy(r.cancellationPolicy, sections),
  } as KlookDetail;
}
