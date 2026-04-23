/**
 * kkday/packages — Narrow projection of get-activity.
 * Returns only { product_id, url, packages } from a KKday product page.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { parseProductId, buildDetailEvaluate } from './detail.js';

cli({
  site: 'kkday',
  name: 'get-packages',
  description: 'Get only the packages[] array for a KKday product (lighter than get-activity)',
  domain: 'www.kkday.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or URL (e.g. "2247")' },
  ],
  columns: ['name', 'price', 'currency'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.product || '').trim();
    if (!input) throw new Error('Product ID or URL is required');

    const productId = parseProductId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.kkday.com/en/product/${productId}`;

    await page.goto(url);
    await page.wait(5000);
    await page.autoScroll({ times: 3, delayMs: 1500 });
    const raw = await page.evaluate(buildDetailEvaluate());

    if (!raw || !(raw as any).title) {
      throw new Error('Could not extract packages. The page structure may have changed.');
    }

    const detail = parseActivityDetail(raw);
    return { product_id: productId, url: detail.url || url, packages: detail.packages };
  },
});
