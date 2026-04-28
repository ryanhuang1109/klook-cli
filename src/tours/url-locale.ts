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
  return platform === 'getyourguide';
}
