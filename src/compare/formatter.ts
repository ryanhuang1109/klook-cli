// src/compare/formatter.ts
import type { CompareResult } from '../shared/types.js';

export function formatMarkdown(result: CompareResult): string {
  const lines: string[] = [];
  lines.push(`## ${result.query} — ${result.date}`);
  lines.push('');

  for (const group of result.groups) {
    lines.push(`### ${group.group_name}`);
    lines.push(`> ${group.description}`);
    lines.push('');
    lines.push('| Platform | Price (USD) | Original | Rating | Reviews | Notes |');
    lines.push('|----------|-------------|----------|--------|---------|-------|');

    for (const p of group.products) {
      const priceStr = p.price_usd != null ? `$${p.price_usd.toFixed(2)}` : '—';
      lines.push(`| ${p.platform} | ${priceStr} | ${p.price_original} | ${p.rating} | ${p.review_count} | ${p.notes} |`);
    }

    lines.push('');
    lines.push(`Best price: **${group.cheapest}** | Best rated: **${group.best_rated}**`);
    lines.push('');
  }

  if (result.currency_rates_used) {
    lines.push(`_Currency rates: ${result.currency_rates_used}_`);
  }

  return lines.join('\n');
}

export function formatJson(result: CompareResult): string {
  return JSON.stringify(result, null, 2);
}
