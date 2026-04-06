import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CompareResult } from '../shared/types.js';

interface HistoryRow {
  poi_name: string;
  date: string;
  run_at: string;
  result: CompareResult;
}

export interface CompareStore {
  saveRun(poiName: string, date: string, result: CompareResult): void;
  getHistory(poiName: string, days: number): HistoryRow[];
  close(): void;
}

export async function createStore(configDir?: string): Promise<CompareStore> {
  const sqljs = await import('sql.js');
  const initSqlJs = sqljs.default;

  const dir = configDir ?? path.join(os.homedir(), '.klook-cli');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'history.db');

  let dbBuffer: Buffer | null = null;
  try {
    dbBuffer = fs.readFileSync(dbPath);
  } catch { /* new db */ }

  const SQL = await initSqlJs();
  const db = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS compare_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poi_name TEXT NOT NULL,
      date TEXT NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      result_json TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_compare_runs_poi ON compare_runs(poi_name, date)`);

  function persist(): void {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  return {
    saveRun(poiName: string, date: string, result: CompareResult): void {
      db.run(
        'INSERT INTO compare_runs (poi_name, date, result_json) VALUES (?, ?, ?)',
        [poiName, date, JSON.stringify(result)]
      );
      persist();
    },

    getHistory(poiName: string, days: number): HistoryRow[] {
      const stmt = db.prepare(
        `SELECT poi_name, date, run_at, result_json FROM compare_runs
         WHERE poi_name = ? AND run_at >= datetime('now', ?)
         ORDER BY run_at DESC`,
      );
      stmt.bind([poiName, `-${days} days`]);
      const rows: HistoryRow[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        rows.push({
          poi_name: row.poi_name,
          date: row.date,
          run_at: row.run_at,
          result: JSON.parse(row.result_json),
        });
      }
      stmt.free();
      return rows;
    },

    close(): void {
      db.close();
    },
  };
}
