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

program.parse();
