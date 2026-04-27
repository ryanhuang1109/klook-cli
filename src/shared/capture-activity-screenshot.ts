/**
 * Capture a viewport screenshot on an already-navigated Browser-Bridge page.
 *
 * Called by trip / getyourguide / kkday get-activity adapters when the user
 * passes `--screenshot <mode>`. Must run AFTER the adapter has finished all
 * its scraping evaluates — we scroll back to top here so the viewport snap
 * shows the hero, not wherever autoScroll left the page.
 *
 * Screenshot output conventions align with src/tours/screenshot.ts:
 *   data/screenshots/<platform>-<id>.png
 *
 * Mode semantics (opt-in — no flag means no screenshot):
 *   - "auto"   → save to default path, return { screenshot_path }
 *   - "base64" → return { screenshot_base64 } inline, no file
 *   - <path>   → save to that path (treated as filesystem path), return { screenshot_path }
 *
 * Errors are non-fatal: on failure we log to stderr and return {} so the
 * caller's structured detail payload is not lost.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IPage } from '@jackwener/opencli/registry';

export type ScreenshotResult =
  | { screenshot_path: string }
  | { screenshot_base64: string }
  | Record<string, never>;

export async function captureActivityScreenshot(
  page: IPage,
  platform: string,
  id: string,
  mode: string | undefined,
): Promise<ScreenshotResult> {
  if (!mode) return {};

  try {
    // Scroll to top so the viewport snap captures the hero/title, not
    // whatever autoScroll left in view. 400ms is enough for smooth scroll
    // and deferred image swaps on the top fold.
    await page.evaluate('window.scrollTo(0, 0)');
    await page.wait(400);

    if (mode === 'base64') {
      const base64 = await page.screenshot({ format: 'png', fullPage: false });
      return { screenshot_base64: base64 };
    }

    const outPath = mode === 'auto'
      ? path.join(process.cwd(), 'data', 'screenshots', `${platform}-${id}.png`)
      : path.resolve(mode);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, format: 'png', fullPage: false });
    return { screenshot_path: outPath };
  } catch (err) {
    process.stderr.write(
      `[screenshot] capture failed for ${platform}/${id}: ${(err as Error).message}\n`,
    );
    return {};
  }
}
