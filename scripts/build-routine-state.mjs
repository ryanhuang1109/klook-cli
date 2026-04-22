#!/usr/bin/env node
/**
 * Dump the current routine configuration + recent sessions into a single
 * static JSON file that /tours.html on Vercel can fetch without a server.
 *
 * Writes:
 *   dist/web/public/routine-state.json
 *
 * The sibling daily-routine.sh stamps data/host-info.json with hostname and
 * last-run timestamp each time cron fires. That file is commited so Vercel
 * sees which machine is running the pipeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function loadSessions() {
  const dbPath = path.join(repoRoot, 'data', 'tours.db');
  if (!fs.existsSync(dbPath)) return [];
  try {
    const sqljsMod = await import('sql.js');
    const initSqlJs = sqljsMod.default;
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(dbPath);
    const db = new SQL.Database(buf);
    const stmt = db.prepare(
      `SELECT id, destination, keyword, poi, competitors, limit_per_platform,
              started_at, finished_at, status
         FROM run_sessions
         ORDER BY started_at DESC
         LIMIT 20`,
    );
    const out = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      let competitors = row.competitors;
      try { competitors = JSON.parse(row.competitors); } catch {}
      out.push({ ...row, competitors });
    }
    stmt.free();
    db.close();
    return out;
  } catch (err) {
    return [{ _error: String(err).slice(0, 200) }];
  }
}

async function main() {
  const config = readJSON(
    path.join(repoRoot, 'data', 'routine-config.json'),
    null,
  );
  const host = readJSON(
    path.join(repoRoot, 'data', 'host-info.json'),
    null,
  );
  const sessions = await loadSessions();

  const state = {
    generated_at: new Date().toISOString(),
    config,
    host,
    sessions,
  };

  const outDir = path.join(repoRoot, 'dist', 'web', 'public');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'routine-state.json');
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  process.stdout.write(`routine-state.json: ${sessions.length} sessions, config=${config ? 'yes' : 'no'}, host=${host ? host.hostname : 'unknown'}\n`);
}

main().catch((err) => {
  process.stderr.write('build-routine-state failed: ' + err.message + '\n');
  // Don't fail the build — the page has graceful fallbacks.
  const outDir = path.join(repoRoot, 'dist', 'web', 'public');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'routine-state.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), error: err.message }, null, 2),
  );
});
