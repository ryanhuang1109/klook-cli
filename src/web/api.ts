// src/web/api.ts
import { Router } from 'express';
import { loadPois, addPoi, removePoi } from '../poi/poi.js';
import { runCompare } from '../compare/compare.js';
import { createStore } from '../compare/store.js';

export function createApiRouter(): Router {
  const router = Router();

  router.get('/pois', (_req, res) => {
    try {
      const pois = loadPois();
      res.json(pois);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/pois', (req, res) => {
    try {
      const { name, keywords, platforms } = req.body;
      if (!name || !Array.isArray(keywords) || !keywords.length) {
        res.status(400).json({ error: 'name and keywords[] are required' });
        return;
      }
      addPoi(undefined, {
        name,
        keywords,
        platforms: Array.isArray(platforms) && platforms.length
          ? platforms
          : ['klook', 'trip', 'getyourguide', 'kkday'],
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/pois/:name', (req, res) => {
    try {
      removePoi(undefined, req.params.name);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/compare', async (req, res) => {
    try {
      const { name, date, save } = req.body;
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const result = await runCompare(name, {
        date,
        format: 'json',
        save: save ?? true,
        limit: 10,
      });
      res.json(JSON.parse(result));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/history/:name', async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const store = await createStore();
      const history = store.getHistory(req.params.name, days);
      store.close();
      res.json(history);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
