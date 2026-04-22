/**
 * Env loader for the tours module.
 *
 * Loads .env.development.local first (user secrets that survive
 * `vercel env pull`), then .env.local (Vercel-managed vars). Later loads do not
 * overwrite earlier keys — matches Next.js/dotenv convention.
 *
 * Call loadEnv() exactly once at CLI bootstrap.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

let loaded = false;

/**
 * Back-compat: the installer script (install.sh) writes the OpenRouter key
 * to ~/.klook-cli/config.json. The compare command reads from there. The
 * newer tours pipeline prefers .env.development.local, but we also honour
 * the legacy config.json so a fresh `install.sh` install works without the
 * user knowing about the new env file.
 */
function loadLegacyConfig(): void {
  const configPath = path.join(os.homedir(), '.klook-cli', 'config.json');
  if (!fs.existsSync(configPath)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    if (typeof cfg.openrouter_api_key === 'string' && !process.env.OPENROUTER_API_KEY) {
      process.env.OPENROUTER_API_KEY = cfg.openrouter_api_key;
    }
  } catch {
    // Malformed config — ignore.
  }
}

export function loadEnv(cwd: string = process.cwd()): void {
  if (loaded) return;
  const files = ['.env.development.local', '.env.local', '.env'];
  for (const f of files) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
  loadLegacyConfig();
  loaded = true;
}

export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Add it to .env.development.local or ~/.klook-cli/config.json`,
    );
  }
  return v;
}
