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
      // GYG locale is **path-based**, not query-string. Verified
      // 2026-04-29 on t63099: ?lang=en/en-US is silently ignored when the
      // browser cookie is non-en (server falls back to cookie locale and
      // the page renders in the cookie's language). The only reliable
      // override is a leading path segment like /en-us/ or /en/. The
      // server canonicalises away the default-locale prefix on render but
      // the html `lang` attribute and the package text both honour it.
      //
      // We accept a few common shapes for `lang`:
      //   "en"     → /en/     (server renders in en-US)
      //   "en-US"  → /en-us/  (preferred — matches html lang exactly)
      //   "en-GB"  → /en-gb/
      //   "pa"     → /pa/     (Punjabi — used by the historical multi-locale
      //                        coverage flow that ingests one URL per language)
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean);
      const localePrefix = lang.toLowerCase();
      // Strip any existing locale prefix so we don't end up with /en-us/zh-tw/...
      const localeRe = /^[a-z]{2}(-[a-z]{2})?$/;
      while (segments.length > 0 && localeRe.test(segments[0])) {
        segments.shift();
      }
      segments.unshift(localePrefix);
      u.pathname = '/' + segments.join('/') + (url.endsWith('/') ? '/' : '');
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
  // GYG: same problem as airbnb — Browser Bridge cookie can stick to a
  // non-en locale (e.g. zh-TW) and the normalizer's price-row regex breaks
  // against the localised price strings, silently producing 0 SKUs even
  // though pricing.ts captured rows. The default `en-US` produces a
  // /en-us/ path prefix which the server renders in English regardless of
  // cookie state. (Earlier we tried ?lang=en — that was a query-string
  // hack that the GYG server ignores when the cookie is non-en. Verified
  // 2026-04-29.)
  if (platform === 'getyourguide') return 'en-US';
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
    if (platform === 'getyourguide') {
      // Only apply if the URL doesn't already start with a locale segment
      // (caller may have passed an explicit `/en-gb/...` URL we should
      // respect).
      const segments = u.pathname.split('/').filter(Boolean);
      const localeRe = /^[a-z]{2}(-[a-z]{2})?$/;
      if (segments.length > 0 && localeRe.test(segments[0])) return url;
      return urlForLanguage(platform, url, lang);
    }
  } catch {
    /* malformed URL — fall through */
  }
  return url;
}
