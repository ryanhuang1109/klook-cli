// src/compare/compare.ts
import { execFileSync } from 'node:child_process';
import type { CompareResult } from '../shared/types.js';
import type { KlookActivity } from '../shared/types.js';
import { loadPois } from '../poi/poi.js';
import { clusterProducts } from './llm.js';
import { formatMarkdown, formatJson } from './formatter.js';
import { createStore } from './store.js';

interface RawProduct {
  platform: string;
  title: string;
  price: string;
  rating: string;
  review_count: string;
  url: string;
}

function searchPlatform(platform: string, keywords: string[], limit: number): RawProduct[] {
  const allResults: RawProduct[] = [];
  const seenUrls = new Set<string>();

  for (const keyword of keywords) {
    try {
      const output = execFileSync('opencli', [
        platform, 'search', keyword, '--limit', String(limit), '-f', 'json',
      ], { encoding: 'utf-8', timeout: 90000 });

      // Strip non-JSON lines (e.g. "Update available" notices from opencli)
      const jsonStr = output
        .split('\n')
        .filter((l) => !l.includes('Update available') && !l.includes('Run: npm'))
        .join('\n');
      const items = JSON.parse(jsonStr) as KlookActivity[];

      for (const item of items) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        allResults.push({
          platform,
          title: item.title,
          price: item.price,
          rating: item.rating,
          review_count: item.review_count,
          url: item.url,
        });
      }
    } catch {
      // Platform search failed — skip, others may still work
    }
  }

  return allResults;
}

export interface CompareOptions {
  date?: string;
  format?: 'markdown' | 'json';
  save?: boolean;
  limit?: number;
}

export async function runCompare(
  poiName: string,
  opts: CompareOptions = {},
): Promise<string> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const format = opts.format ?? 'markdown';
  const limit = opts.limit ?? 10;

  // Load POI config
  const pois = loadPois();
  const poi = pois.find((p) => p.name === poiName);
  if (!poi) {
    throw new Error(`POI "${poiName}" not found. Run: klook-cli poi add "${poiName}" --keywords "..."`);
  }

  // Search all platforms (sequential to avoid overwhelming browser bridge)
  const allProducts: RawProduct[] = [];
  for (const platform of poi.platforms) {
    const results = searchPlatform(platform, poi.keywords, limit);
    allProducts.push(...results);
  }

  if (allProducts.length === 0) {
    throw new Error(`No results found across any platform for "${poiName}"`);
  }

  // Cluster via LLM
  const result = await clusterProducts(allProducts, poiName, date);

  // Save to history if requested
  if (opts.save) {
    const store = await createStore();
    store.saveRun(poiName, date, result);
    store.close();
  }

  // Format output
  return format === 'json' ? formatJson(result) : formatMarkdown(result);
}

export async function runCompareAll(opts: CompareOptions = {}): Promise<string> {
  const pois = loadPois();
  if (pois.length === 0) {
    throw new Error('No POIs configured. Run: klook-cli poi add "..." --keywords "..."');
  }

  const outputs: string[] = [];
  for (const poi of pois) {
    try {
      const output = await runCompare(poi.name, opts);
      outputs.push(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outputs.push(`## ${poi.name}\n\nError: ${msg}\n`);
    }
  }

  return outputs.join('\n---\n\n');
}
