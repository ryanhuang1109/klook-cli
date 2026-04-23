/**
 * trip/packages — Narrow projection of get-activity.
 * Returns only { activity_id, url, packages } from a Trip.com activity page.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { parseActivityId, buildDetailEvaluate } from './detail.js';

cli({
  site: 'trip',
  name: 'get-packages',
  description: 'Get only the packages[] array for a Trip.com activity (lighter than get-activity)',
  domain: 'www.trip.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'activity', required: true, positional: true, help: 'Activity ID or URL (e.g. "92795279")' },
  ],
  columns: ['name', 'price', 'currency'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.activity || '').trim();
    if (!input) throw new Error('Activity ID or URL is required');

    const activityId = parseActivityId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.trip.com/things-to-do/detail/${activityId}/`;

    await page.goto(url);
    await page.wait(6000);
    await page.autoScroll({ times: 3, delayMs: 1500 });
    await page.wait(2000);
    const raw = await page.evaluate(buildDetailEvaluate());

    if (!raw || !(raw as any).title) {
      throw new Error('Could not extract packages. The page structure may have changed.');
    }

    const detail = parseActivityDetail(raw);
    return { activity_id: activityId, url: detail.url || url, packages: detail.packages };
  },
});
