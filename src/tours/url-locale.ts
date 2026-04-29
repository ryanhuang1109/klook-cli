/**
 * Per-platform URL locale transforms.
 *
 * Some OTAs render entirely different package sets depending on the page's
 * language hint. GYG is the canonical example — `?lang=pa` shrinks 3
 * packages down to 1 because Punjabi-speaking drivers only operate the
 * cheapest tour. To capture all of them in our DB we need to ingest the
 * same activity once per language, with the locale baked into the URL we
 * hand to opencli.
 *
 * Each transform is best-effort — when we don't know how to localise a
 * platform's URL we return the original. Adding a new platform: prove the
 * transform in a real browser first (some sites use cookies, not URL
 * params, in which case URL transform is a no-op and we'd need a Browser
 * Bridge cookie override instead).
 */
import type { Platform } from './types.js';

/**
 * Lift the platform's URL to a specific locale. Returns the URL unchanged
 * when the transform is unknown for this platform — caller decides whether
 * to surface that as an error or silently proceed under whatever locale
 * the cookie already pinned.
 */
export function urlForLanguage(platform: Platform, url: string, lang: string): string {
  if (!lang || !url) return url;
  try {
    if (platform === 'getyourguide') {
      // GYG uses ?lang=<iso2> query param — verified on Mt Fuji
      // t797962 where ?lang=en yields 3 packages, ?lang=pa yields 1.
      const u = new URL(url);
      u.searchParams.set('lang', lang);
      return u.toString();
    }
    // TODO: klook (/en-US/ path segment), kkday (/en/), trip (?locale=),
    // airbnb (?locale= or cookie). Add when each platform's multi-lang
    // behaviour is validated against its real DOM.
  } catch {
    /* malformed URL — fall through */
  }
  return url;
}

/**
 * Whether the platform supports our URL transform — callers use this to
 * decide whether multi-language ingest is meaningful or whether passing
 * `language` would silently no-op.
 */
export function platformSupportsLanguageUrl(platform: Platform): boolean {
  return platform === 'getyourguide' || platform === 'airbnb';
}

/**
 * Default locale to apply when caller didn't specify one. Used by adapters
 * that prefer English data even when the Browser Bridge cookie is set to a
 * different locale. Returns null when the platform should leave URLs alone
 * (cookie-only locale, no opinion).
 */
export function defaultLanguageForPlatform(platform: Platform): string | null {
  // Airbnb: cookie pins the locale and we have no enforced way to set it
  // from CLI, so the URL param ?locale=en-US is the safest default. Verified
  // against airbnb experience pages — the param overrides the cookie hint
  // for that single navigation.
  if (platform === 'airbnb') return 'en-US';
  return null;
}

/**
 * Apply the platform's default locale URL transform when the URL doesn't
 * already carry a locale param. No-op when the URL already has a hint
 * (caller's choice wins) or when the platform has no default policy.
 */
export function applyDefaultLanguage(platform: Platform, url: string): string {
  if (!url.startsWith('http')) return url;
  const lang = defaultLanguageForPlatform(platform);
  if (!lang) return url;
  try {
    const u = new URL(url);
    if (platform === 'airbnb' && !u.searchParams.has('locale')) {
      u.searchParams.set('locale', lang);
      return u.toString();
    }
    if (platform === 'getyourguide' && !u.searchParams.has('lang')) {
      // No default for GYG today — coverage is per-listing, not per-call.
      return url;
    }
  } catch {
    /* malformed URL — fall through */
  }
  return url;
}
