/**
 * klook/packages — Narrow projection of get-activity.
 *
 * Same scrape as get-activity, but returns only { activity_id, url, packages }.
 * Lighter payload for downstream price-only consumers; compute cost is the same.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { parseActivityId, buildDetailEvaluate } from './detail.js';

cli({
  site: 'klook',
  name: 'get-packages',
  description: 'Get only the packages[] array for a Klook activity (lighter than get-activity)',
  domain: 'www.klook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or full URL' },
  ],
  columns: ['name', 'price', 'currency'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.klook.com/activity/${activityId}/`;

    await page.goto(url);
    await page.autoScroll({ times: 3, delayMs: 1000 });
    const raw = await page.evaluate(buildDetailEvaluate());

    if (!raw || !(raw as any).title) {
      throw new Error('Could not extract packages. The page structure may have changed or login may be required.');
    }

    const detail = parseActivityDetail(raw);
    return { activity_id: activityId, url: detail.url || url, packages: detail.packages };
  },
});
