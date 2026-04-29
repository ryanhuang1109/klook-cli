/**
 * SQLite persistence for Activity / Package / SKU.
 *
 * Uses sql.js (already a repo dependency) to stay consistent with the existing
 * compare store. Writes through to disk after every mutation so partial runs
 * don't lose data.
 *
 * Path: data/tours.db (relative to repo root). Creates schema on first open.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Activity,
  Package,
  SKU,
  SKUObservation,
  ReviewStatus,
} from './types.js';

type SqlJsStatic = any;
type SqlJsDB = any;

export interface ToursDB {
  /**
   * Upsert helpers return `true` when the underlying SQLite statement
   * actually changed a row (insert or update), `false` when it was a no-op.
   * Callers use this to compute "real DB writes" instead of trusting
   * `normalized.skus.length`, which masks silent normalizer/schema
   * failures (e.g. the GYG zh-TW regression in 2026-04-29).
   */
  upsertActivity(a: Activity): boolean;
  upsertPackage(p: Package): boolean;
  upsertSKU(s: SKU): boolean;
  /** Returns true when a new observation row was appended. */
  appendObservation(o: SKUObservation): boolean;

  getActivity(id: string): Activity | null;
  getActivityByUrl(url: string): Activity | null;
  listActivities(filters?: { platform?: string; poi?: string }): Activity[];
  listPackagesForActivity(activityId: string): Package[];
  listSKUsForPackage(packageId: string): SKU[];
  listAllRowsForExport(): ExportRow[];

  reviewActivity(id: string, status: ReviewStatus, note: string | null): void;
  reviewSKU(id: string, status: ReviewStatus, note: string | null): void;

  /** Returns column names for the given table (uses PRAGMA table_info). */
  rawColumns(table: string): string[];

  listActivitySummaries(): ActivitySummaryRow[];

  logSearchRun(run: SearchRunLog): void;
  listSearchRuns(opts?: { sinceHoursAgo?: number }): SearchRunLog[];

  startSession(s: SessionStart): void;
  finishSession(id: string, status: 'done' | 'failed'): void;
  listSessions(opts?: { limit?: number }): RunSession[];

  logExecution(e: ExecutionLog): void;
  listExecutionsForSession(sessionId: string): ExecutionLog[];
  listRecentExecutions(opts?: { sinceHoursAgo?: number; limit?: number }): ExecutionLog[];

  logCoverageRun(run: CoverageRunLog): void;
  listCoverageRuns(opts?: { poi?: string; platform?: string }): CoverageRunRow[];

  /**
   * Raw dump for the Supabase mirror. Returns SQLite-shape rows (booleans as
   * 0/1, array fields as JSON strings) — the sync layer is responsible for
   * the PG-shape transform. `since` filters the time-based tables on their
   * timestamp column; reference tables (activities/packages/skus) are always
   * returned in full because they're upserted by primary key.
   */
  dumpForSync(opts?: { since?: string }): SyncDump;

  close(): void;
}

export interface SyncDump {
  activities: any[];
  packages: any[];
  skus: any[];
  observations: any[];
  sessions: any[];
  executions: any[];
  searchRuns: any[];
  coverageRuns: any[];
}

export interface SearchRunLog {
  platform: string;
  keyword: string;
  poi: string;
  total_found: number;
  ingested: number;
  succeeded: number;
  failed: number;
  run_at?: string;
}

export interface CoverageRunLog {
  poi: string;
  platform: string;
  filter_signature: string;
  total_reported: number | null;
  fetched: number;
  new_unique: number;
  run_at?: string;
}

export interface CoverageRunRow extends CoverageRunLog {
  id: number;
  run_at: string;
}

export interface SessionStart {
  id: string;
  destination: string;
  keyword: string;
  poi: string;
  competitors: string[];
  limit: number;
  started_at?: string;
}

export interface RunSession {
  id: string;
  destination: string;
  keyword: string;
  poi: string;
  competitors: string;
  limit_per_platform: number;
  started_at: string;
  finished_at: string | null;
  status: string;
}

export interface ExecutionLog {
  id?: number;
  session_id: string | null;
  platform: string;
  activity_id: string;
  strategy: 'opencli-pricing' | 'opencli-detail' | 'opencli-search' | 'agent-browser-fallback' | 'snapshot';
  started_at?: string;
  duration_ms: number;
  succeeded: number;                // 0 or 1 (SQLite-friendly)
  error_message: string | null;
  packages_written: number;
  skus_written: number;
  fallback_reason: string | null;
}

export interface ActivitySummaryRow {
  id: string;
  platform: string;
  platform_product_id: string;
  canonical_url: string;
  title: string;
  poi: string | null;
  supplier: string | null;
  rating: number | null;
  review_count: number | null;
  order_count: number | null;
  cancellation_policy: string | null;
  package_count: number;
  sku_count: number;
  min_price_usd: number | null;
  max_price_usd: number | null;
  last_scraped_at: string;
  review_status: string;
  raw_extras_json: string;
}

export interface ExportRow {
  activity_id: string;
  platform: string;
  canonical_url: string;
  title: string;
  supplier: string | null;
  cancellation_policy: string | null;
  poi: string | null;
  departure_city_activity: string | null;
  package_id: string;
  package_title: string;
  tour_type: string;
  group_size: string;
  meals: number | null;
  departure_city_pkg: string | null;
  departure_time: string | null;
  available_languages: string;
  sku_id: string;
  travel_date: string;
  price_local: number | null;
  price_usd: number | null;
  currency: string | null;
  available: number;
  last_checked_at: string;
  activity_review_status: string;
  sku_review_status: string;
}

export async function openDB(dbPath?: string): Promise<ToursDB> {
  const sqljs = await import('sql.js');
  const initSqlJs = (sqljs as any).default;

  const finalPath = dbPath ?? path.join(process.cwd(), 'data', 'tours.db');
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  let buf: Buffer | null = null;
  try {
    buf = fs.readFileSync(finalPath);
  } catch {
    /* new db */
  }

  const SQL: SqlJsStatic = await initSqlJs();
  const db: SqlJsDB = buf ? new SQL.Database(buf) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_product_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      supplier TEXT,
      poi TEXT,
      duration_minutes INTEGER,
      departure_city TEXT,
      rating REAL,
      review_count INTEGER,
      order_count INTEGER,
      description TEXT,
      cancellation_policy TEXT,
      raw_extras_json TEXT NOT NULL DEFAULT '{}',
      first_scraped_at TEXT NOT NULL,
      last_scraped_at TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'unverified',
      review_note TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_act_platform_pid ON activities(platform, platform_product_id);
    CREATE INDEX IF NOT EXISTS idx_act_poi ON activities(poi);

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      platform_package_id TEXT,
      title TEXT NOT NULL,
      tour_type TEXT NOT NULL,
      available_languages TEXT NOT NULL,
      group_size TEXT NOT NULL,
      meals INTEGER,
      departure_city TEXT,
      departure_time TEXT,
      duration_minutes INTEGER,
      inclusions TEXT NOT NULL DEFAULT '[]',
      exclusions TEXT NOT NULL DEFAULT '[]',
      completeness_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(activity_id) REFERENCES activities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pkg_activity ON packages(activity_id);

    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      price_local REAL,
      price_usd REAL,
      currency TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'unverified',
      review_note TEXT,
      FOREIGN KEY(package_id) REFERENCES packages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sku_pkg_date ON skus(package_id, travel_date);

    CREATE TABLE IF NOT EXISTS run_sessions (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      keyword TEXT NOT NULL,
      poi TEXT NOT NULL,
      competitors TEXT NOT NULL,
      limit_per_platform INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      platform TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      error_message TEXT,
      packages_written INTEGER NOT NULL DEFAULT 0,
      skus_written INTEGER NOT NULL DEFAULT 0,
      fallback_reason TEXT,
      FOREIGN KEY(session_id) REFERENCES run_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_exec_session ON execution_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_exec_started ON execution_logs(started_at DESC);

    CREATE TABLE IF NOT EXISTS search_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      keyword TEXT NOT NULL,
      poi TEXT NOT NULL,
      total_found INTEGER NOT NULL,
      ingested INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_search_runs_time ON search_runs(run_at DESC);

    CREATE TABLE IF NOT EXISTS sku_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      price_local REAL,
      price_usd REAL,
      available INTEGER NOT NULL,
      FOREIGN KEY(sku_id) REFERENCES skus(id)
    );
    CREATE INDEX IF NOT EXISTS idx_obs_sku ON sku_observations(sku_id, checked_at);

    CREATE TABLE IF NOT EXISTS coverage_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poi TEXT NOT NULL,
      platform TEXT NOT NULL,
      filter_signature TEXT NOT NULL,
      total_reported INTEGER,
      fetched INTEGER NOT NULL,
      new_unique INTEGER NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coverage_poi ON coverage_runs(poi, platform, run_at DESC);
  `);

  // Lightweight column migrations for DBs created before a column existed.
  // SQLite has no `ADD COLUMN IF NOT EXISTS`, so probe PRAGMA first.
  const activityCols = db.prepare(`PRAGMA table_info(activities)`);
  const existingCols = new Set<string>();
  while (activityCols.step()) existingCols.add((activityCols.getAsObject() as any).name as string);
  activityCols.free();
  if (!existingCols.has('cancellation_policy')) {
    db.run(`ALTER TABLE activities ADD COLUMN cancellation_policy TEXT`);
  }
  if (!existingCols.has('is_pinned')) {
    db.run(`ALTER TABLE activities ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`);
  }

  function persist(): void {
    const data = db.export();
    fs.writeFileSync(finalPath, Buffer.from(data));
  }

  function one<T>(sql: string, params: unknown[]): T | null {
    const stmt = db.prepare(sql);
    stmt.bind(params as any);
    const row = stmt.step() ? (stmt.getAsObject() as any as T) : null;
    stmt.free();
    return row;
  }

  function all<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params as any);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as any as T);
    stmt.free();
    return out;
  }

  // Single source of truth for activity column order (SELECT and INSERT stay in sync).
  const ACTIVITY_COLS = [
    'id', 'platform', 'platform_product_id', 'canonical_url', 'title',
    'supplier', 'poi', 'duration_minutes', 'departure_city',
    'rating', 'review_count', 'order_count', 'description',
    'cancellation_policy', 'raw_extras_json',
    'first_scraped_at', 'last_scraped_at',
    'review_status', 'review_note',
    'is_pinned',
  ] as const;

  return {
    upsertActivity(a) {
      db.run(
        `INSERT INTO activities (${ACTIVITY_COLS.join(', ')})
         VALUES (${ACTIVITY_COLS.map(() => '?').join(', ')})
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           supplier = COALESCE(excluded.supplier, activities.supplier),
           poi = COALESCE(excluded.poi, activities.poi),
           duration_minutes = COALESCE(excluded.duration_minutes, activities.duration_minutes),
           departure_city = COALESCE(excluded.departure_city, activities.departure_city),
           rating = COALESCE(excluded.rating, activities.rating),
           review_count = COALESCE(excluded.review_count, activities.review_count),
           order_count = COALESCE(excluded.order_count, activities.order_count),
           description = COALESCE(excluded.description, activities.description),
           cancellation_policy = COALESCE(excluded.cancellation_policy, activities.cancellation_policy),
           raw_extras_json = excluded.raw_extras_json,
           last_scraped_at = excluded.last_scraped_at,
           is_pinned = activities.is_pinned`,
        [
          a.id, a.platform, a.platform_product_id, a.canonical_url, a.title,
          a.supplier, a.poi, a.duration_minutes, a.departure_city,
          a.rating, a.review_count, a.order_count, a.description,
          a.cancellation_policy,
          a.raw_extras_json,
          a.first_scraped_at, a.last_scraped_at, a.review_status, a.review_note,
          a.is_pinned ?? 0,
        ],
      );
      const changed = db.getRowsModified() > 0;
      persist();
      return changed;
    },

    upsertPackage(p) {
      db.run(
        `INSERT INTO packages (id, activity_id, platform_package_id, title, tour_type, available_languages, group_size, meals, departure_city, departure_time, duration_minutes, inclusions, exclusions, completeness_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           tour_type = excluded.tour_type,
           available_languages = excluded.available_languages,
           group_size = excluded.group_size,
           meals = excluded.meals,
           departure_city = excluded.departure_city,
           departure_time = excluded.departure_time,
           duration_minutes = excluded.duration_minutes,
           inclusions = excluded.inclusions,
           exclusions = excluded.exclusions,
           completeness_json = excluded.completeness_json`,
        [
          p.id, p.activity_id, p.platform_package_id, p.title, p.tour_type,
          JSON.stringify(p.available_languages), p.group_size,
          p.meals == null ? null : p.meals ? 1 : 0,
          p.departure_city, p.departure_time, p.duration_minutes,
          JSON.stringify(p.inclusions), JSON.stringify(p.exclusions),
          p.completeness_json,
        ],
      );
      const changed = db.getRowsModified() > 0;
      persist();
      return changed;
    },

    upsertSKU(s) {
      db.run(
        `INSERT INTO skus (id, package_id, travel_date, price_local, price_usd, currency, available, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           price_local = excluded.price_local,
           price_usd = excluded.price_usd,
           currency = excluded.currency,
           available = excluded.available,
           last_checked_at = excluded.last_checked_at`,
        [
          s.id, s.package_id, s.travel_date, s.price_local, s.price_usd,
          s.currency, s.available ? 1 : 0, s.last_checked_at,
        ],
      );
      const changed = db.getRowsModified() > 0;
      persist();
      return changed;
    },

    appendObservation(o) {
      db.run(
        `INSERT INTO sku_observations (sku_id, checked_at, price_local, price_usd, available)
         VALUES (?, ?, ?, ?, ?)`,
        [o.sku_id, o.checked_at, o.price_local, o.price_usd, o.available ? 1 : 0],
      );
      const changed = db.getRowsModified() > 0;
      persist();
      return changed;
    },

    getActivity(id) {
      return one<Activity>(`SELECT ${ACTIVITY_COLS.join(', ')} FROM activities WHERE id = ?`, [id]);
    },

    getActivityByUrl(url) {
      return one<Activity>(`SELECT ${ACTIVITY_COLS.join(', ')} FROM activities WHERE canonical_url = ?`, [url]);
    },

    listActivities(filters = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filters.platform) {
        where.push('platform = ?');
        params.push(filters.platform);
      }
      if (filters.poi) {
        where.push('poi = ?');
        params.push(filters.poi);
      }
      const sql = `SELECT ${ACTIVITY_COLS.join(', ')} FROM activities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_scraped_at DESC`;
      return all<Activity>(sql, params);
    },

    listPackagesForActivity(activityId) {
      const rows = all<any>(`SELECT * FROM packages WHERE activity_id = ?`, [activityId]);
      return rows.map((r) => ({
        ...r,
        available_languages: JSON.parse(r.available_languages || '[]'),
        inclusions: JSON.parse(r.inclusions || '[]'),
        exclusions: JSON.parse(r.exclusions || '[]'),
        meals: r.meals == null ? null : r.meals === 1,
      })) as Package[];
    },

    listSKUsForPackage(packageId) {
      const rows = all<any>(
        `SELECT * FROM skus WHERE package_id = ? ORDER BY travel_date`,
        [packageId],
      );
      return rows.map((r) => ({ ...r, available: r.available === 1 })) as SKU[];
    },

    listAllRowsForExport() {
      return all<ExportRow>(`
        SELECT
          a.id AS activity_id,
          a.platform AS platform,
          a.canonical_url AS canonical_url,
          a.title AS title,
          a.supplier AS supplier,
          a.cancellation_policy AS cancellation_policy,
          a.poi AS poi,
          a.departure_city AS departure_city_activity,
          p.id AS package_id,
          p.title AS package_title,
          p.tour_type AS tour_type,
          p.group_size AS group_size,
          p.meals AS meals,
          p.departure_city AS departure_city_pkg,
          p.departure_time AS departure_time,
          p.available_languages AS available_languages,
          s.id AS sku_id,
          s.travel_date AS travel_date,
          s.price_local AS price_local,
          s.price_usd AS price_usd,
          s.currency AS currency,
          s.available AS available,
          s.last_checked_at AS last_checked_at,
          a.review_status AS activity_review_status,
          s.review_status AS sku_review_status
        FROM activities a
        JOIN packages p ON p.activity_id = a.id
        JOIN skus s ON s.package_id = p.id
        ORDER BY a.platform, a.poi, a.title, p.title, s.travel_date
      `);
    },

    listActivitySummaries() {
      return all<ActivitySummaryRow>(`
        SELECT
          a.id, a.platform, a.platform_product_id, a.canonical_url, a.title,
          a.poi, a.supplier, a.rating, a.review_count, a.order_count,
          a.cancellation_policy,
          a.last_scraped_at, a.review_status, a.raw_extras_json,
          COUNT(DISTINCT p.id) AS package_count,
          COUNT(DISTINCT s.id) AS sku_count,
          MIN(s.price_usd) AS min_price_usd,
          MAX(s.price_usd) AS max_price_usd
        FROM activities a
        LEFT JOIN packages p ON p.activity_id = a.id
        LEFT JOIN skus s ON s.package_id = p.id
        GROUP BY a.id
        ORDER BY a.platform, a.poi, a.title
      `);
    },

    startSession(s) {
      db.run(
        `INSERT INTO run_sessions (id, destination, keyword, poi, competitors, limit_per_platform, status)
         VALUES (?, ?, ?, ?, ?, ?, 'running')`,
        [s.id, s.destination, s.keyword, s.poi, JSON.stringify(s.competitors), s.limit],
      );
      persist();
    },

    finishSession(id, status) {
      db.run(
        `UPDATE run_sessions SET finished_at = datetime('now'), status = ? WHERE id = ?`,
        [status, id],
      );
      persist();
    },

    listSessions(opts = {}) {
      return all<RunSession>(
        `SELECT * FROM run_sessions ORDER BY started_at DESC LIMIT ?`,
        [opts.limit ?? 20],
      );
    },

    logExecution(e) {
      db.run(
        `INSERT INTO execution_logs (session_id, platform, activity_id, strategy, duration_ms, succeeded, error_message, packages_written, skus_written, fallback_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.session_id, e.platform, e.activity_id, e.strategy,
          e.duration_ms, e.succeeded, e.error_message,
          e.packages_written, e.skus_written, e.fallback_reason,
        ],
      );
      persist();
    },

    listExecutionsForSession(sessionId) {
      return all<ExecutionLog>(
        `SELECT * FROM execution_logs WHERE session_id = ? ORDER BY started_at`,
        [sessionId],
      );
    },

    listRecentExecutions(opts = {}) {
      const since = opts.sinceHoursAgo ?? 24;
      return all<ExecutionLog>(
        `SELECT * FROM execution_logs
         WHERE started_at >= datetime('now', ?)
         ORDER BY started_at DESC LIMIT ?`,
        [`-${since} hours`, opts.limit ?? 100],
      );
    },

    logSearchRun(run) {
      db.run(
        `INSERT INTO search_runs (platform, keyword, poi, total_found, ingested, succeeded, failed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [run.platform, run.keyword, run.poi, run.total_found, run.ingested, run.succeeded, run.failed],
      );
      persist();
    },

    listSearchRuns(opts = {}) {
      const since = opts.sinceHoursAgo ?? 24;
      return all<SearchRunLog>(
        `SELECT platform, keyword, poi, total_found, ingested, succeeded, failed, run_at
         FROM search_runs
         WHERE run_at >= datetime('now', ?)
         ORDER BY run_at DESC`,
        [`-${since} hours`],
      );
    },

    reviewActivity(id, status, note) {
      db.run(
        `UPDATE activities SET review_status = ?, review_note = ? WHERE id = ?`,
        [status, note, id],
      );
      persist();
    },

    reviewSKU(id, status, note) {
      db.run(
        `UPDATE skus SET review_status = ?, review_note = ? WHERE id = ?`,
        [status, note, id],
      );
      persist();
    },

    logCoverageRun(run) {
      db.run(
        `INSERT INTO coverage_runs (poi, platform, filter_signature, total_reported, fetched, new_unique)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [run.poi, run.platform, run.filter_signature, run.total_reported, run.fetched, run.new_unique],
      );
      persist();
    },

    listCoverageRuns(opts = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.poi) {
        where.push('poi = ?');
        params.push(opts.poi);
      }
      if (opts.platform) {
        where.push('platform = ?');
        params.push(opts.platform);
      }
      const sql = `SELECT id, poi, platform, filter_signature, total_reported, fetched, new_unique, run_at
                   FROM coverage_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY run_at DESC, id DESC`;
      return all<CoverageRunRow>(sql, params);
    },

    dumpForSync(opts = {}) {
      const since = opts.since ?? null;
      const activities = all<any>(`SELECT ${ACTIVITY_COLS.join(', ')} FROM activities`);
      const packages = all<any>(`SELECT * FROM packages`);
      const skus = all<any>(`SELECT * FROM skus`);
      const observations = since
        ? all<any>(
            `SELECT * FROM sku_observations WHERE checked_at >= ? ORDER BY id`,
            [since],
          )
        : all<any>(`SELECT * FROM sku_observations ORDER BY id`);
      const sessions = all<any>(`SELECT * FROM run_sessions`);
      const executions = since
        ? all<any>(
            `SELECT * FROM execution_logs WHERE started_at >= ? ORDER BY id`,
            [since],
          )
        : all<any>(`SELECT * FROM execution_logs ORDER BY id`);
      const searchRuns = since
        ? all<any>(
            `SELECT id, platform, keyword, poi, total_found, ingested, succeeded, failed, run_at
             FROM search_runs WHERE run_at >= ? ORDER BY id`,
            [since],
          )
        : all<any>(
            `SELECT id, platform, keyword, poi, total_found, ingested, succeeded, failed, run_at
             FROM search_runs ORDER BY id`,
          );
      const coverageRuns = since
        ? all<any>(
            `SELECT id, poi, platform, filter_signature, total_reported, fetched, new_unique, run_at
             FROM coverage_runs WHERE run_at >= ? ORDER BY id`,
            [since],
          )
        : all<any>(
            `SELECT id, poi, platform, filter_signature, total_reported, fetched, new_unique, run_at
             FROM coverage_runs ORDER BY id`,
          );
      return { activities, packages, skus, observations, sessions, executions, searchRuns, coverageRuns };
    },

    rawColumns(table: string): string[] {
      const ALLOWED = new Set([
        'activities', 'packages', 'skus', 'sku_observations',
        'run_sessions', 'execution_logs', 'search_runs', 'coverage_runs',
      ]);
      if (!ALLOWED.has(table)) {
        throw new Error(`rawColumns: unknown table "${table}"`);
      }
      const stmt = db.prepare(`PRAGMA table_info(${table})`);
      const out: string[] = [];
      while (stmt.step()) out.push((stmt.getAsObject() as any).name);
      stmt.free();
      return out;
    },

    close() {
      db.close();
    },
  };
}
