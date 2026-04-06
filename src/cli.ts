#!/usr/bin/env node
/**
 * klook — Standalone CLI entry point.
 *
 * Imports opencli's registry to access registered commands, and
 * uses BrowserBridge directly to create browser sessions.
 *
 * Usage: klook search "Tokyo" --format json
 */

import { Command } from 'commander';
import { getRegistry, fullName } from '@jackwener/opencli/registry';
import type { CliCommand } from '@jackwener/opencli/registry';

// Import adapters to register them in the global registry
import './clis/klook/search.js';
import './clis/klook/trending.js';
import './clis/klook/detail.js';
import './clis/trip/search.js';
import './clis/trip/detail.js';
import './clis/getyourguide/search.js';
import './clis/getyourguide/detail.js';
import './clis/kkday/search.js';
import './clis/kkday/detail.js';

async function runWithBrowser(cmd: CliCommand, kwargs: Record<string, unknown>): Promise<unknown> {
  // BrowserBridge is not in opencli's public API — try dynamic import
  // If this fails, the user should use `opencli klook/search` instead
  let BrowserBridge: any;
  try {
    // @ts-ignore — @jackwener/opencli/browser is not in public API but may exist at runtime
    const browserModule = await import('@jackwener/opencli/browser');
    BrowserBridge = browserModule.BrowserBridge;
  } catch {
    // Fallback: try internal path
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const opencliPath = require.resolve('@jackwener/opencli');
    const { dirname, join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const browserPath = join(dirname(opencliPath), 'browser', 'index.js');
    const mod = await import(pathToFileURL(browserPath).href);
    BrowserBridge = mod.BrowserBridge;
  }

  const bridge = new BrowserBridge();
  const page = await bridge.connect({ timeout: 30, workspace: `site:${cmd.site}` });

  // Pre-navigate to domain for cookie access
  if (cmd.domain) {
    await page.goto(`https://${cmd.domain}`);
  }

  if (!cmd.func) {
    throw new Error(`Command ${fullName(cmd)} has no func`);
  }

  return cmd.func(page, kwargs);
}

const program = new Command();
program
  .name('klook')
  .description('Klook.com CLI — search activities, trending, and pricing')
  .version('0.1.0');

// Wire each registered klook/* command as a top-level subcommand
const registry = getRegistry();
for (const [key, cmd] of registry) {
  if (cmd.site !== 'klook') continue;
  if (key !== fullName(cmd)) continue; // skip alias entries

  const sub = program.command(cmd.name);
  sub.description(cmd.description);

  for (const arg of cmd.args) {
    if (arg.positional) {
      sub.argument(arg.required ? `<${arg.name}>` : `[${arg.name}]`, arg.help ?? '');
    } else {
      const flag = `--${arg.name} <value>`;
      sub.option(flag, arg.help ?? '', arg.default as string | boolean | string[] | undefined);
    }
  }

  sub.option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table');

  sub.action(async (...actionArgs: unknown[]) => {
    const opts = actionArgs[actionArgs.length - 2] as Record<string, unknown>;
    const positionals = actionArgs.slice(0, -2) as string[];

    // Map positional args
    const kwargs: Record<string, unknown> = { ...opts };
    const positionalDefs = cmd.args.filter((a) => a.positional);
    positionalDefs.forEach((def, i) => {
      if (positionals[i] !== undefined) kwargs[def.name] = positionals[i];
    });

    try {
      const result = await runWithBrowser(cmd, kwargs);
      const fmt = String(kwargs.format || 'table');
      if (fmt === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // For non-JSON formats, still output JSON for now
        // Full format support can be added later using opencli's render()
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
}

// ── POI commands ──────────────────────────────────────────────────
const poiCmd = program.command('poi').description('Manage POIs (Points of Interest) to monitor');

poiCmd
  .command('add <name>')
  .description('Add a POI to monitor')
  .requiredOption('--keywords <keywords>', 'Comma-separated search keywords')
  .option('--platforms <platforms>', 'Comma-separated platforms', 'klook,trip,getyourguide,kkday')
  .action(async (name: string, opts: { keywords: string; platforms: string }) => {
    const { addPoi } = await import('./poi/poi.js');
    try {
      addPoi(undefined, {
        name,
        keywords: opts.keywords.split(',').map((k) => k.trim()),
        platforms: opts.platforms.split(',').map((p) => p.trim()),
      });
      console.log(`Added POI: ${name}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

poiCmd
  .command('list')
  .description('List all configured POIs')
  .action(async () => {
    const { loadPois } = await import('./poi/poi.js');
    const pois = loadPois();
    if (pois.length === 0) {
      console.log('No POIs configured. Run: klook-cli poi add "..." --keywords "..."');
      return;
    }
    for (const poi of pois) {
      console.log(`${poi.name}`);
      console.log(`  Keywords: ${poi.keywords.join(', ')}`);
      console.log(`  Platforms: ${poi.platforms.join(', ')}`);
      console.log('');
    }
  });

poiCmd
  .command('remove <name>')
  .description('Remove a POI')
  .action(async (name: string) => {
    const { removePoi } = await import('./poi/poi.js');
    try {
      removePoi(undefined, name);
      console.log(`Removed POI: ${name}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Compare command ───────────────────────────────────────────────
program
  .command('compare [name]')
  .description('Compare a POI across platforms (or --all for all POIs)')
  .option('--date <date>', 'Date for pricing (YYYY-MM-DD)')
  .option('--all', 'Run comparison for all configured POIs')
  .option('--save', 'Save results to history database')
  .option('-f, --format <fmt>', 'Output format: markdown, json', 'markdown')
  .option('--limit <n>', 'Max results per platform', '10')
  .action(async (name: string | undefined, opts: any) => {
    const { runCompare, runCompareAll } = await import('./compare/compare.js');
    try {
      let output: string;
      const compareOpts = {
        date: opts.date,
        format: opts.format === 'json' ? 'json' as const : 'markdown' as const,
        save: opts.save ?? false,
        limit: parseInt(opts.limit) || 10,
      };

      if (opts.all) {
        output = await runCompareAll(compareOpts);
      } else if (name) {
        output = await runCompare(name, compareOpts);
      } else {
        console.error('Error: provide a POI name or use --all');
        process.exit(1);
        return;
      }
      console.log(output);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// ── Compare history command ───────────────────────────────────────
program
  .command('compare-history <name>')
  .description('Show price change history for a POI')
  .option('--days <n>', 'Number of days to look back', '7')
  .action(async (name: string, opts: { days: string }) => {
    const { createStore } = await import('./compare/store.js');
    const days = parseInt(opts.days) || 7;
    const store = await createStore();
    const history = store.getHistory(name, days);
    store.close();

    if (history.length === 0) {
      console.log(`No history found for "${name}" in the last ${days} days.`);
      console.log('Run: klook-cli compare "..." --save');
      return;
    }

    console.log(`${name} — price history (last ${days} days)\n`);
    for (const run of history) {
      console.log(`=== ${run.run_at} (date: ${run.date}) ===`);
      for (const group of run.result.groups) {
        console.log(`  ${group.group_name}:`);
        for (const p of group.products) {
          const price = p.price_usd != null ? `$${p.price_usd.toFixed(2)}` : '—';
          console.log(`    ${p.platform}: ${price} (${p.price_original})`);
        }
      }
      console.log('');
    }
  });

program.parse();
