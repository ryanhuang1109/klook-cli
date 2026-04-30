/**
 * Routine config — the JSON blob that drives `scripts/daily-routine.sh`.
 *
 * Source of truth lives in Supabase (`routine_config` table, singleton row
 * id=1). Local cron materialises it into `data/routine-config.json` at the
 * start of each run via `tours routine fetch-config`. Web Schedule page
 * edits the Supabase row.
 *
 * Falling back to the local JSON when Supabase is unreachable keeps
 * routines running even with intermittent network — the file remains the
 * cron's actual input.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSupabaseClient } from './supabase-sync.js';
import { loadEnv } from './env.js';

export interface RoutinePoi {
  destination: string;
  keyword: string;
  poi: string;
}

/**
 * Shape mirrors the existing data/routine-config.json so we don't have to
 * migrate the cron script's reader. New keys can be added freely; unknown
 * keys are preserved on round-trip (server stores the JSON as-is).
 */
export interface RoutineConfig {
  pois: RoutinePoi[];
  competitors: string[];
  limit_per_platform: number;
  screenshot?: boolean;
  sort?: 'reviews' | 'recommended';
  agent_mode_on_retry?: 'oneshot' | 'loop' | 'none';
  /** Optional: extras the JSON file might carry. */
  [k: string]: unknown;
}

export interface FetchResult {
  config: RoutineConfig;
  source: 'supabase' | 'local-fallback';
  updated_at?: string | null;
  updated_by?: string | null;
}

const DEFAULT_LOCAL_PATH = 'data/routine-config.json';

/**
 * Read the singleton row from Supabase. Throws if Supabase is unreachable
 * or the row is missing — callers (the CLI fetch command) decide whether
 * to fall back to the local file.
 */
export async function fetchRoutineConfigFromSupabase(): Promise<FetchResult> {
  loadEnv();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('routine_config')
    .select('config, updated_at, updated_by')
    .eq('id', 1)
    .single();
  if (error) throw new Error(`supabase fetch failed: ${error.message}`);
  if (!data) throw new Error('supabase routine_config row missing');
  return {
    config: data.config as RoutineConfig,
    source: 'supabase',
    updated_at: data.updated_at as string | null,
    updated_by: data.updated_by as string | null,
  };
}

export function readLocalConfig(filePath: string = DEFAULT_LOCAL_PATH): RoutineConfig {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as RoutineConfig;
}

export function writeLocalConfig(
  config: RoutineConfig,
  filePath: string = DEFAULT_LOCAL_PATH,
): void {
  const abs = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Write the singleton row in Supabase. UPSERT so first run after a fresh
 * migration also works. `updated_by` is a free-text label so the audit
 * trail can distinguish web edits from CLI pushes.
 */
export async function pushRoutineConfigToSupabase(
  config: RoutineConfig,
  updated_by: string = 'cli:push',
): Promise<{ updated_at: string }> {
  loadEnv();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('routine_config')
    .upsert(
      { id: 1, config, updated_by, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select('updated_at')
    .single();
  if (error) throw new Error(`supabase push failed: ${error.message}`);
  return { updated_at: data.updated_at as string };
}

/**
 * Used by the cron script: prefer Supabase, fall back to local on any
 * failure (network, missing key, missing row). The fallback path also
 * means a fresh checkout works without a Supabase service-role key set.
 */
export async function fetchOrFallback(
  filePath: string = DEFAULT_LOCAL_PATH,
): Promise<FetchResult> {
  try {
    return await fetchRoutineConfigFromSupabase();
  } catch (err) {
    const local = readLocalConfig(filePath);
    return {
      config: local,
      source: 'local-fallback',
      updated_at: null,
      updated_by: `fallback: ${(err as Error).message.slice(0, 120)}`,
    };
  }
}
