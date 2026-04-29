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
// Canonical top-level commands: add-poi / list-pois / remove-poi
// Legacy subcommand group: poi add / poi list / poi remove (still supported)
async function actionAddPoi(name: string, opts: { keywords: string; platforms: string }) {
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
}

async function actionListPois() {
  const { loadPois } = await import('./poi/poi.js');
  const pois = loadPois();
  if (pois.length === 0) {
    console.log('No POIs configured. Run: klook-cli add-poi "..." --keywords "..."');
    return;
  }
  for (const poi of pois) {
    console.log(`${poi.name}`);
    console.log(`  Keywords: ${poi.keywords.join(', ')}`);
    console.log(`  Platforms: ${poi.platforms.join(', ')}`);
    console.log('');
  }
}

async function actionRemovePoi(name: string) {
  const { removePoi } = await import('./poi/poi.js');
  try {
    removePoi(undefined, name);
    console.log(`Removed POI: ${name}`);
  } catch (err: unknown) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// Canonical top-level
program
  .command('add-poi <name>')
  .description('Add a POI to monitor')
  .requiredOption('--keywords <keywords>', 'Comma-separated search keywords')
  .option('--platforms <platforms>', 'Comma-separated platforms', 'klook,trip,getyourguide,kkday')
  .action(actionAddPoi);

program
  .command('list-pois')
  .description('List all configured POIs')
  .action(actionListPois);

program
  .command('remove-poi <name>')
  .description('Remove a POI')
  .action(actionRemovePoi);

// Legacy subcommand group (aliases for backwards compat)
const poiCmd = program.command('poi').description('Manage POIs (alias group — prefer add-poi / list-pois / remove-poi)');

poiCmd
  .command('add <name>')
  .description('Add a POI to monitor (alias: add-poi)')
  .requiredOption('--keywords <keywords>', 'Comma-separated search keywords')
  .option('--platforms <platforms>', 'Comma-separated platforms', 'klook,trip,getyourguide,kkday')
  .action(actionAddPoi);

poiCmd
  .command('list')
  .description('List all configured POIs (alias: list-pois)')
  .action(actionListPois);

poiCmd
  .command('remove <name>')
  .description('Remove a POI (alias: remove-poi)')
  .action(actionRemovePoi);

// ── Compare command ───────────────────────────────────────────────
program
  .command('compare-poi [name]')
  .alias('compare')
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

// ── Tours commands ────────────────────────────────────────────────
const toursCmd = program
  .command('tours')
  .description('Tours pipeline: ingest pricing, export to CSV, generate HTML report, cross-platform match');

toursCmd
  .command('ingest-pricing <platform> <activity-id>')
  .alias('ingest')
  .description('Run opencli pricing for one activity and store in tours DB')
  .option('--poi <poi>', 'POI label (e.g. "Mount Fuji")')
  .option('--days <n>', 'Days of pricing to fetch', '7')
  .option('--url <url>', 'Canonical URL override')
  .action(async (platform: string, activityId: string, opts: any) => {
    const { cmdIngest } = await import('./tours/commands.js');
    try {
      await cmdIngest({
        platform,
        activityId,
        poi: opts.poi,
        days: parseInt(opts.days) || 7,
        url: opts.url,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('ingest-from-detail <platform> <activity-id>')
  .alias('ingest-detail')
  .description('Fallback ingest using opencli <platform> get-activity (works when pricing scraper fails)')
  .option('--poi <poi>', 'POI label')
  .option('--url <url>', 'Canonical URL override')
  .option('--travel-date <d>', 'Travel date label for the stored SKUs (default: tomorrow)')
  .option('--screenshot', 'Also capture a page screenshot to data/screenshots/', false)
  .option('--agent-mode <mode>', 'Agent fallback mode when opencli returns 0 packages: none | oneshot | loop', 'oneshot')
  .action(async (platform: string, activityId: string, opts: any) => {
    const { cmdIngestDetail } = await import('./tours/commands.js');
    try {
      await cmdIngestDetail({
        platform,
        activityId,
        poi: opts.poi,
        url: opts.url,
        travelDate: opts.travelDate,
        screenshot: !!opts.screenshot,
        agentMode: opts.agentMode === 'loop' ? 'loop' : opts.agentMode === 'none' ? 'none' : 'oneshot',
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('run-daily-routine')
  .alias('run')
  .description('End-to-end: iterate each competitor, ingest-top-from-search, then export CSV + HTML report')
  .requiredOption('--destination <d>', 'Destination (e.g. "bangkok", "tokyo")')
  .option('--keyword <k>', 'Subvertical / theme keyword (e.g. "temple", "river cruise")', '')
  .requiredOption('--competitors <list>', 'Comma-separated platforms: klook,trip,getyourguide,kkday')
  .option('--poi <poi>', 'POI label (defaults to keyword or destination)')
  .option('--limit <n>', 'Top N per platform after ranking (default 30)', '30')
  .option('--sort <key>', 'reviews | recommended', 'reviews')
  .option('--screenshot', 'Capture a screenshot per activity', false)
  .action(async (opts: any) => {
    const { cmdRun } = await import('./tours/commands.js');
    try {
      await cmdRun({
        destination: opts.destination,
        keyword: opts.keyword,
        competitors: opts.competitors.split(',').map((s: string) => s.trim()),
        poi: opts.poi,
        limit: parseInt(opts.limit) || 30,
        sortBy: opts.sort === 'recommended' ? 'recommended' : 'reviews',
        screenshot: !!opts.screenshot,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('ingest-top-from-search <platform> <keyword>')
  .alias('ingest-search')
  .description('Search opencli for keyword, rank by review count, ingest top N via get-activity fallback')
  .requiredOption('--poi <poi>', 'POI label to assign to discovered activities')
  .option('--limit <n>', 'Top N results to ingest after ranking (default 30)', '30')
  .option('--sort <key>', 'Sort before ingest: reviews (default) or recommended', 'reviews')
  .option('--screenshot', 'Capture a screenshot per activity', false)
  .action(async (platform: string, keyword: string, opts: any) => {
    const { cmdIngestSearch } = await import('./tours/commands.js');
    try {
      await cmdIngestSearch({
        platform,
        keyword,
        poi: opts.poi,
        limit: parseInt(opts.limit) || 30,
        sortBy: opts.sort === 'recommended' ? 'recommended' : 'reviews',
        screenshot: !!opts.screenshot,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('ingest-from-snapshot <platform> <file>')
  .alias('ingest-snapshot')
  .description('Ingest a previously saved pricing JSON snapshot (skips scraping)')
  .option('--poi <poi>', 'POI label')
  .option('--url <url>', 'Canonical URL override')
  .action(async (platform: string, file: string, opts: any) => {
    const { cmdIngestSnapshot } = await import('./tours/commands.js');
    try {
      await cmdIngestSnapshot({ platform, file, poi: opts.poi, url: opts.url });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('ingest-from-planning-csv <csv>')
  .alias('ingest-from-golden')
  .description('Read the planning CSV, ingest all unique (platform, activity_id) targets')
  .option('--platforms <list>', 'Comma-separated platforms to include')
  .option('--days <n>', 'Days of pricing to fetch', '7')
  .option('--limit <n>', 'Only process first N targets')
  .option('--dry-run', 'Print targets without scraping', false)
  .action(async (csv: string, opts: any) => {
    const { cmdIngestFromGolden } = await import('./tours/commands.js');
    try {
      await cmdIngestFromGolden({
        csv,
        platforms: opts.platforms ? opts.platforms.split(',').map((s: string) => s.trim()) : undefined,
        days: parseInt(opts.days) || 7,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        dryRun: !!opts.dryRun,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('export-csv')
  .alias('export')
  .description('Export the tours DB to a CSV matching the planning sheet format')
  .option('--out <path>', 'Output CSV path (default: data/exports/<today>.csv)')
  .option('--pois <list>', 'Comma-separated POIs to include')
  .option('--platforms <list>', 'Comma-separated platforms to include')
  .option('--date <date>', 'Only include SKUs for this travel date (YYYY-MM-DD)')
  .action(async (opts: any) => {
    const { cmdExport } = await import('./tours/commands.js');
    try {
      await cmdExport({
        out: opts.out,
        pois: opts.pois ? opts.pois.split(',').map((s: string) => s.trim()) : undefined,
        platforms: opts.platforms ? opts.platforms.split(',').map((s: string) => s.trim()) : undefined,
        date: opts.date,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('generate-report')
  .alias('report')
  .description('Generate HTML summary report (coverage, completeness, recent rows)')
  .option('--out <path>', 'Output HTML path')
  .action(async (opts: any) => {
    const { cmdReport } = await import('./tours/commands.js');
    try {
      await cmdReport({ out: opts.out });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('list-activities')
  .alias('list')
  .description('List all activities currently in the tours DB')
  .option('--platform <p>', 'Filter by platform')
  .option('--poi <poi>', 'Filter by POI')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: any) => {
    const { cmdListActivities } = await import('./tours/commands.js');
    await cmdListActivities({ platform: opts.platform, poi: opts.poi, format: opts.format });
  });

toursCmd
  .command('set-sku-review-status <sku-id> <status>')
  .alias('review-sku')
  .description('Mark an SKU as verified | flagged | rejected | unverified')
  .option('--note <note>', 'Reason / note for the review')
  .action(async (skuId: string, status: string, opts: any) => {
    const { cmdReviewSKU } = await import('./tours/commands.js');
    try {
      await cmdReviewSKU({ sku_id: skuId, status, note: opts.note });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('set-activity-review-status <id> <status>')
  .alias('review-activity')
  .description('Mark an activity as verified | flagged | rejected | unverified')
  .option('--note <note>', 'Reason / note for the review')
  .action(async (id: string, status: string, opts: any) => {
    const { cmdReviewActivity } = await import('./tours/commands.js');
    try {
      await cmdReviewActivity({ id, status, note: opts.note });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('find-cross-platform-match <url>')
  .alias('match-from-url')
  .description('Given a URL on one platform, find similar tours on another (LLM-ranked)')
  .requiredOption('--to <platform>', 'Target platform (trip, kkday, getyourguide, klook)')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .option('--model <m>', 'OpenRouter model slug (default: openai/gpt-4o-mini)')
  .option('--limit <n>', 'Max candidates to fetch per search phrase', '8')
  .action(async (url: string, opts: any) => {
    const { cmdMatchFromUrl } = await import('./tours/commands.js');
    try {
      await cmdMatchFromUrl({
        url,
        to: opts.to,
        format: opts.format,
        model: opts.model,
        limit: parseInt(opts.limit) || 8,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('ingest-listing')
  .description('Ingest a Listing JSON (per-POI per-platform filtered slice) and record coverage')
  .requiredOption('--file <path>', 'Path to a Listing JSON file (see src/tours/listing.ts for schema)')
  .option('--no-pricing', 'Only dedupe + log coverage; skip pricing/detail fetch for new IDs')
  .option('--no-detail', 'Skip the detail fetch (supplier / cancellation / description); just run pricing')
  .option('--days <n>', 'Days of pricing matrix per new activity', '7')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: { file: string; noPricing?: boolean; noDetail?: boolean; days?: string; pricing?: boolean; detail?: boolean; format?: string }) => {
    const { cmdIngestListing } = await import('./tours/commands.js');
    try {
      // commander turns --no-pricing / --no-detail into opts.pricing===false / opts.detail===false
      const noPricing = opts.pricing === false;
      const noDetail = opts.detail === false;
      await cmdIngestListing({
        file: opts.file,
        noPricing,
        noDetail,
        days: opts.days ? parseInt(opts.days) : undefined,
        format: opts.format,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('coverage-report')
  .description('Saturation summary per (POI, platform) — cumulative_unique vs reported total')
  .option('--poi <name>', 'Filter to a single POI')
  .option('--platform <p>', 'Filter to a single platform')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: { poi?: string; platform?: string; format?: string }) => {
    const { cmdCoverageReport } = await import('./tours/commands.js');
    try {
      await cmdCoverageReport({ poi: opts.poi, platform: opts.platform, format: opts.format });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('sync-to-supabase')
  .description('Mirror the local tours DB to the Supabase Postgres project')
  .option('--since <iso>', 'Only sync time-based rows newer than this ISO timestamp')
  .option('--dry-run', 'Report counts only — do not write to Supabase')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: { since?: string; dryRun?: boolean; format?: string }) => {
    const { cmdSyncToSupabase } = await import('./tours/commands.js');
    try {
      await cmdSyncToSupabase({ since: opts.since, dryRun: opts.dryRun, format: opts.format });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('preflight-locale')
  .description('Audit Browser Bridge cookie + html lang per OTA. Adapters expect en/en-US — non-English silently breaks normalization.')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: { format?: string }) => {
    const { cmdPreflightLocale } = await import('./tours/commands.js');
    try {
      await cmdPreflightLocale({ format: opts.format });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

toursCmd
  .command('verify-supabase-sync')
  .description('Compare row counts between local SQLite and Supabase')
  .option('-f, --format <fmt>', 'Output format: text, json', 'text')
  .action(async (opts: { format?: string }) => {
    const { cmdVerifySupabaseSync } = await import('./tours/commands.js');
    try {
      await cmdVerifySupabaseSync({ format: opts.format });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── Compare history command ───────────────────────────────────────
program
  .command('get-poi-price-history <name>')
  .alias('compare-history')
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
