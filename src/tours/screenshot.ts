/**
 * Capture real page screenshots via the opencli Browser Bridge.
 *
 * Unlike the hero image (which is just the first CDN img on the page), a
 * screenshot proves we actually rendered the page. Useful for:
 *   - BD review ("did the scraper actually see the current listing?")
 *   - Incident debugging when a scraper returns unexpected data
 *
 * Screenshots are saved to data/screenshots/<platform>-<id>.png.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

async function getBrowserBridge(): Promise<any> {
  try {
    // @ts-ignore — not in public exports but present at runtime
    const mod = await import('@jackwener/opencli/browser');
    return mod.BrowserBridge;
  } catch {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const opencliPath = require.resolve('@jackwener/opencli');
    const { dirname, join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const browserPath = join(dirname(opencliPath), 'browser', 'index.js');
    const mod = await import(pathToFileURL(browserPath).href);
    return mod.BrowserBridge;
  }
}

export interface CaptureOptions {
  fullPage?: boolean;
  /** Milliseconds to wait after navigation before capturing. */
  settleMs?: number;
  /** Auto-scroll N times before capturing to trigger lazy images. */
  scrollTimes?: number;
  /** Override the output directory. Default: data/screenshots. */
  outDir?: string;
}

export async function captureScreenshot(
  url: string,
  platform: string,
  productId: string,
  opts: CaptureOptions = {},
): Promise<string> {
  const outDir = opts.outDir ?? path.join(process.cwd(), 'data', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${platform}-${productId}.png`);

  const BrowserBridge = await getBrowserBridge();
  const bridge = new BrowserBridge();
  const page = await bridge.connect({
    timeout: 45,
    workspace: `site:${platform}`,
  });

  await page.goto(url);
  await page.wait(opts.settleMs ?? 4000);

  if (opts.scrollTimes && opts.scrollTimes > 0) {
    await page.autoScroll({ times: opts.scrollTimes, delayMs: 600 });
    await page.wait(1500);
    // Scroll back to top so the "top of the page" is what we capture
    await page.evaluate('window.scrollTo(0, 0)');
    await page.wait(600);
  }

  await page.screenshot({
    path: outPath,
    format: 'png',
    fullPage: opts.fullPage ?? false,
  });

  return outPath;
}
