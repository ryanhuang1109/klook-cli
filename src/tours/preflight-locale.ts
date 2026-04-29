/**
 * Browser-Bridge locale audit.
 *
 * The Browser Bridge cookie store is shared with the user's real Chrome
 * profile (via the `setup-browser-cookies` skill). Adapters across all four
 * OTAs are written against en-US/en DOM and silently break under non-English
 * locales — the GYG zh-TW regression on 2026-04-29 produced 0 SKUs in the DB
 * even though pricing.ts captured rows, because the normalizer's price-parse
 * regex couldn't match localised Chinese price strings.
 *
 * This module navigates each OTA homepage, reads the active cookie + html
 * lang, and reports per-platform locale state. We deliberately do NOT
 * force-set cookies here: most OTAs rewrite the locale cookie server-side
 * on the next request, so cookie-poking is best-effort and the durable fix
 * is "use setup-browser-cookies skill in en-US Chrome profile". Treat this
 * as an audit + warning surface.
 */
import { execFileSync } from 'node:child_process';

export interface PlatformLocale {
  platform: string;
  homeUrl: string;
  cookieLocale: string | null;
  htmlLang: string | null;
  ok: boolean;
  hint: string;
}

interface PlatformDef {
  platform: string;
  homeUrl: string;
  /** Pattern that means "English content" — trip uses "en-US", others "en". */
  okLangPattern: RegExp;
  /** Cookie key used by the platform to remember locale. */
  cookieKey: string;
}

const PLATFORMS: PlatformDef[] = [
  {
    platform: 'klook',
    homeUrl: 'https://www.klook.com/en-US/',
    okLangPattern: /^en/i,
    cookieKey: 'kepler_lang',
  },
  {
    platform: 'kkday',
    homeUrl: 'https://www.kkday.com/en/',
    okLangPattern: /^en/i,
    cookieKey: 'lang',
  },
  {
    platform: 'getyourguide',
    homeUrl: 'https://www.getyourguide.com/?lang=en',
    okLangPattern: /^en/i,
    cookieKey: 'locale_code',
  },
  {
    platform: 'trip',
    homeUrl: 'https://www.trip.com/?locale=en-US',
    okLangPattern: /^en/i,
    cookieKey: 'language',
  },
];

function execBrowser(args: string[]): string {
  try {
    return execFileSync('opencli', ['browser', ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    return `__ERROR__: ${(err as Error).message.slice(0, 200)}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function auditOne(p: PlatformDef): Promise<PlatformLocale> {
  execBrowser(['open', p.homeUrl]);
  await sleep(3000);

  const evalScript = `
    (() => {
      const cookieKey = ${JSON.stringify(p.cookieKey)};
      const cookieMatch = document.cookie.match(new RegExp('(?:^|; )' + cookieKey + '=([^;]+)'));
      return {
        cookieLocale: cookieMatch ? cookieMatch[1] : null,
        htmlLang: document.documentElement.lang || null,
        url: location.href,
      };
    })()
  `;
  const out = execBrowser(['eval', evalScript]);
  let parsed: any = {};
  try {
    // opencli browser eval prints JSON-compatible output.
    const stripped = out.split('\n').filter((l) => !l.includes('Update available') && !l.includes('Run: npm')).join('\n');
    parsed = JSON.parse(stripped);
  } catch {
    parsed = { error: 'parse-failed', raw: out.slice(0, 200) };
  }

  const cookieLocale = parsed.cookieLocale ?? null;
  const htmlLang = parsed.htmlLang ?? null;
  const langOk = htmlLang ? p.okLangPattern.test(htmlLang) : false;
  const cookieOk = cookieLocale == null || p.okLangPattern.test(cookieLocale);
  const ok = langOk && cookieOk;

  let hint = '';
  if (!langOk && htmlLang) {
    hint = `html lang="${htmlLang}" — adapters expect en/en-US. Open ${p.homeUrl} in your real Chrome, switch to English, then re-run setup-browser-cookies.`;
  } else if (!cookieOk && cookieLocale) {
    hint = `cookie ${p.cookieKey}=${cookieLocale} suggests non-English — server may rewrite back. Force locale via real Chrome + setup-browser-cookies.`;
  } else if (langOk) {
    hint = 'locale clean';
  } else {
    hint = `could not read locale — page may have failed to load. Raw: ${JSON.stringify(parsed).slice(0, 120)}`;
  }

  return {
    platform: p.platform,
    homeUrl: p.homeUrl,
    cookieLocale,
    htmlLang,
    ok,
    hint,
  };
}

export async function auditBrowserLocales(): Promise<PlatformLocale[]> {
  const out: PlatformLocale[] = [];
  for (const p of PLATFORMS) {
    out.push(await auditOne(p));
  }
  return out;
}
