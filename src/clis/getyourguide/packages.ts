/**
 * getyourguide/packages — Narrow projection of get-activity.
 * Returns only { activity_id, url, packages } from a GYG activity page.
 *
 * Note: GYG exposes language as a variant axis via a dropdown. The full
 * get-activity command surfaces those; this narrow projection drops them
 * and returns only whatever packages the detail scraper produced.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { parseActivityId, buildDetailEvaluate } from './detail.js';

cli({
  site: 'getyourguide',
  name: 'get-packages',
  description: 'Get only the packages[] array for a GetYourGuide activity (lighter than get-activity)',
  domain: 'www.getyourguide.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or URL (e.g. "t12345" or full URL)' },
  ],
  columns: ['name', 'price', 'currency'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.getyourguide.com/activity/t${activityId}/`;

    await page.goto(url);
    await page.wait(5000);
    await page.autoScroll({ times: 2, delayMs: 1000 });
    const raw = await page.evaluate(buildDetailEvaluate());

    if (!raw || !(raw as any).title) {
      throw new Error('Could not extract packages. The page structure may have changed.');
    }

    const detail = parseActivityDetail(raw);
    return { activity_id: activityId, url: detail.url || url, packages: detail.packages };
  },
});
