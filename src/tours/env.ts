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
import * as path from 'node:path';
import * as dotenv from 'dotenv';

let loaded = false;

export function loadEnv(cwd: string = process.cwd()): void {
  if (loaded) return;
  const files = ['.env.development.local', '.env.local', '.env'];
  for (const f of files) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
    }
  }
  loaded = true;
}

export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Add it to .env.development.local`,
    );
  }
  return v;
}
