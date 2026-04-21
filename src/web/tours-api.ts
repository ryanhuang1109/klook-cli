/**
 * Web API routes for the tours pipeline.
 *
 * POST /api/tours/run       — kicks off a `tours run` as a child process,
 *                             returns immediately with the session id so the
 *                             browser can poll for progress.
 * GET  /api/tours/sessions  — list recent sessions (newest first)
 * GET  /api/tours/sessions/:id        — session metadata
 * GET  /api/tours/sessions/:id/logs   — per-activity execution logs for a session
 * GET  /api/tours/latest-report       — link to the most recent HTML report
 */
import { Router } from 'express';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDB } from '../tours/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_PLATFORMS = new Set(['klook', 'trip', 'kkday', 'getyourguide']);

export function createToursRouter(): Router {
  const router = Router();

  router.post('/run', async (req, res) => {
    try {
      const { destination, keyword, competitors, limit, screenshot, poi } = req.body ?? {};
      if (!destination && !keyword) {
        res.status(400).json({ error: 'destination or keyword is required' });
        return;
      }
      if (!Array.isArray(competitors) || competitors.length === 0) {
        res.status(400).json({ error: 'competitors[] is required' });
        return;
      }
      const cleaned = competitors
        .map((c: string) => String(c).trim().toLowerCase())
        .filter((c: string) => VALID_PLATFORMS.has(c));
      if (cleaned.length === 0) {
        res.status(400).json({ error: `No valid competitors. Choose from: ${[...VALID_PLATFORMS].join(', ')}` });
        return;
      }

      const repoRoot = path.resolve(path.join(__dirname, '..', '..'));
      const cliEntry = path.join(repoRoot, 'dist', 'cli.js');
      const args = [
        cliEntry, 'tours', 'run',
        '--destination', String(destination ?? ''),
      ];
      if (keyword) args.push('--keyword', String(keyword));
      args.push('--competitors', cleaned.join(','));
      if (poi) args.push('--poi', String(poi));
      if (limit) args.push('--limit', String(parseInt(String(limit), 10) || 30));
      if (screenshot) args.push('--screenshot');

      // Detach so the HTTP request doesn't block on the 10-20 minute run
      const child = spawn('node', args, {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // We can't return the session_id yet — cmdRun generates it internally.
      // Return the *start* timestamp so the frontend can poll /sessions and
      // find the new one.
      const startedAt = new Date().toISOString();
      child.unref();

      res.json({
        ok: true,
        started_at: startedAt,
        message: 'Tours run started in background. Poll /api/tours/sessions for status.',
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/sessions', async (req, res) => {
    try {
      const db = await openDB();
      const limit = parseInt(String(req.query.limit ?? '20'), 10) || 20;
      const sessions = db.listSessions({ limit });
      db.close();
      res.json(sessions);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/sessions/:id', async (req, res) => {
    try {
      const db = await openDB();
      const sessions = db.listSessions({ limit: 200 });
      const session = sessions.find((s) => s.id === req.params.id);
      if (!session) {
        db.close();
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const logs = db.listExecutionsForSession(req.params.id);
      db.close();

      const bySubTotal = {
        total: logs.length,
        succeeded: logs.filter((l) => l.succeeded === 1).length,
        failed: logs.filter((l) => l.succeeded === 0).length,
        packages: logs.reduce((a, l) => a + l.packages_written, 0),
        skus: logs.reduce((a, l) => a + l.skus_written, 0),
      };

      res.json({ session, summary: bySubTotal, logs });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/sessions/:id/logs', async (req, res) => {
    try {
      const db = await openDB();
      const logs = db.listExecutionsForSession(req.params.id);
      db.close();
      res.json(logs);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/latest-report', (_req, res) => {
    const repoRoot = path.resolve(path.join(__dirname, '..', '..'));
    const latestPath = path.join(repoRoot, 'data', 'reports', 'latest.html');
    res.sendFile(latestPath, (err) => {
      if (err) {
        res.status(404).send('No report yet — run a tours session first.');
      }
    });
  });

  return router;
}
