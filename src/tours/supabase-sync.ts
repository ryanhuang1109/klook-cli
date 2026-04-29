/**
 * One-way mirror: SQLite (data/tours.db) -> Supabase Postgres.
 *
 * SQLite is the source of truth. The Supabase project is a read mirror for
 * dashboards / teammates / external queries, and it's safe to fully resync
 * because every write here is an upsert keyed by primary key (or by the
 * (sku_id, checked_at) natural key for sku_observations).
 *
 * Why service role: this code only runs server-side (CLI / scheduled
 * routine), it needs to write to all tables, and RLS is currently deny-all on
 * everything. Service role bypasses RLS — that's the intended path. Never
 * expose this key to a browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ToursDB } from './db.js';
import { loadEnv, requireEnv } from './env.js';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;
  loadEnv();
  _client = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}

export interface SyncOptions {
  /** ISO timestamp; only sync time-based tables newer than this. */
  since?: string;
  /** Don't write — just report what would be sent. */
  dryRun?: boolean;
}

export interface SyncResult {
  counts: Record<string, number>;
  durationMs: number;
  dryRun: boolean;
}

const CHUNK = 500;

async function upsertChunked(
  client: SupabaseClient,
  table: string,
  rows: unknown[],
  conflictTarget: string,
  /** When true, conflicts are silently ignored (used for append-only tables). */
  ignoreDuplicates = false,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await client.from(table).upsert(chunk, {
      onConflict: conflictTarget,
      ignoreDuplicates,
    });
    if (error) {
      throw new Error(
        `Supabase upsert failed: table=${table} offset=${i} chunk=${chunk.length} message=${error.message}`,
      );
    }
  }
}

const i01 = (n: number | null | undefined): boolean | null =>
  n == null ? null : n === 1;

export async function syncToSupabase(
  db: ToursDB,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const start = Date.now();
  const dump = db.dumpForSync({ since: opts.since });

  // SQLite -> PG transforms.
  //   * 0/1 INTEGER -> BOOLEAN (skus.available, sku_observations.available,
  //     execution_logs.succeeded, packages.meals).
  //   * activities/packages/skus already have JSON-as-TEXT columns that map
  //     1:1 to the PG TEXT columns, so they pass through.
  const activities = dump.activities;
  const packages = dump.packages.map((p) => ({
    ...p,
    meals: i01(p.meals),
  }));
  const skus = dump.skus.map((s) => ({
    ...s,
    available: s.available === 1,
  }));
  const observations = dump.observations.map((o) => {
    const { id: _omitId, ...rest } = o; // PG owns the surrogate id
    return { ...rest, available: o.available === 1 };
  });
  const sessions = dump.sessions;
  const executions = dump.executions.map((e) => ({
    ...e,
    succeeded: e.succeeded === 1,
  }));
  const searchRuns = dump.searchRuns;
  const coverageRuns = dump.coverageRuns;

  const counts: Record<string, number> = {
    activities: activities.length,
    packages: packages.length,
    skus: skus.length,
    sku_observations: observations.length,
    run_sessions: sessions.length,
    execution_logs: executions.length,
    search_runs: searchRuns.length,
    coverage_runs: coverageRuns.length,
  };

  if (opts.dryRun) {
    return { counts, durationMs: Date.now() - start, dryRun: true };
  }

  const client = getSupabaseClient();

  // Order matters — children reference parents via FK.
  await upsertChunked(client, 'activities', activities, 'id');
  await upsertChunked(client, 'packages', packages, 'id');
  await upsertChunked(client, 'skus', skus, 'id');
  await upsertChunked(client, 'run_sessions', sessions, 'id');
  await upsertChunked(client, 'execution_logs', executions, 'id');
  await upsertChunked(client, 'search_runs', searchRuns, 'id');
  await upsertChunked(client, 'coverage_runs', coverageRuns, 'id');
  // Append-only natural-key dedupe — re-running sync won't double-count history.
  await upsertChunked(
    client,
    'sku_observations',
    observations,
    'sku_id,checked_at',
    true,
  );

  return { counts, durationMs: Date.now() - start, dryRun: false };
}

/**
 * Compare row counts in SQLite vs Supabase. Used by `tours verify-supabase-sync`.
 * Doesn't dedupe — just sanity-checks that totals line up.
 */
export async function verifySupabaseSync(db: ToursDB): Promise<{
  table: string;
  sqlite: number;
  supabase: number | null;
  ok: boolean;
  error?: string;
}[]> {
  const client = getSupabaseClient();
  const dump = db.dumpForSync();
  const expected: [string, number][] = [
    ['activities', dump.activities.length],
    ['packages', dump.packages.length],
    ['skus', dump.skus.length],
    ['sku_observations', dump.observations.length],
    ['run_sessions', dump.sessions.length],
    ['execution_logs', dump.executions.length],
    ['search_runs', dump.searchRuns.length],
    ['coverage_runs', dump.coverageRuns.length],
  ];
  const out: { table: string; sqlite: number; supabase: number | null; ok: boolean; error?: string }[] = [];
  for (const [table, sqlite] of expected) {
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      out.push({ table, sqlite, supabase: null, ok: false, error: error.message });
    } else {
      const supabase = count ?? 0;
      out.push({ table, sqlite, supabase, ok: supabase >= sqlite });
    }
  }
  return out;
}
