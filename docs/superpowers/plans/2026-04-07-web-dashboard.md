# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Express web server with a single-page UI for BD colleagues to manage POIs, trigger comparisons, and view results via browser.

**Architecture:** Express server on port 17890 serving REST API + static HTML. API routes call existing modules (`poi.ts`, `compare.ts`, `store.ts`) directly. Frontend is a single vanilla HTML file with Tailwind CDN and shadcn-inspired black/white styling. All dynamic content rendered via `textContent` or the `esc()` helper which uses `textContent`-based escaping to prevent XSS.

**Tech Stack:** Express, vanilla HTML/JS, Tailwind CSS CDN

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/web/server.ts` | Express app setup, static file serving, starts listening on 17890 |
| `src/web/api.ts` | API route handlers: GET/POST/DELETE pois, POST compare, GET history |
| `src/web/public/index.html` | Single-page frontend: POI management, compare controls, results table, history |
| `package.json` | Add express dependency, add `"web"` script, update build to copy static files |

---

### Task 1: Install Express and Create Server + API

**Files:**
- Modify: `package.json`
- Create: `src/web/server.ts`
- Create: `src/web/api.ts`

- [ ] **Step 1: Install express**

```bash
cd /Users/ryan.huang/Documents/klook/klook-cli
npm install express
npm install -D @types/express
```

- [ ] **Step 2: Update package.json scripts**

Add to the `"scripts"` section:

```json
"web": "node dist/web/server.js"
```

And replace the `"build"` script with:

```json
"build": "tsc && cp -r src/web/public dist/web/public"
```

- [ ] **Step 3: Create `src/web/api.ts`**

```typescript
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
```

- [ ] **Step 4: Create `src/web/server.ts`**

```typescript
// src/web/server.ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 17890;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createApiRouter());

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`klook-cli web dashboard: http://localhost:${PORT}`);
});
```

- [ ] **Step 5: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/web/server.ts src/web/api.ts package.json package-lock.json
git commit -m "feat: add Express server with REST API for web dashboard"
```

---

### Task 2: Frontend HTML

**Files:**
- Create: `src/web/public/index.html`

Single HTML file with Tailwind CDN. All user-provided data is escaped via `esc()` which uses `document.createElement('div').textContent` assignment to prevent XSS. No raw `innerHTML` with unsanitized user input.

- [ ] **Step 1: Create `src/web/public/index.html`**

Create the file at `/Users/ryan.huang/Documents/klook/klook-cli/src/web/public/index.html` with a single-page dashboard containing:

**Layout (4 sections):**

1. **POI Management card** (left column):
   - List all POIs with name, keywords, platforms, delete button
   - Add POI form: name input, keywords input, platform checkboxes, Add button
   - Calls `GET /api/pois`, `POST /api/pois`, `DELETE /api/pois/:name`

2. **Compare Controls card** (right column):
   - POI dropdown, date picker (default today), "Run Compare" button
   - Loading spinner during compare (1-2 min)
   - Calls `POST /api/compare`

3. **Results area** (full width below):
   - One card per group: group_name heading, description, products table
   - Table columns: Platform, Price (USD), Original, Rating, Reviews, Notes, Link
   - "cheapest" and "best rated" badges
   - Currency rates footer

4. **History section** (bottom):
   - POI dropdown + days selector + Load button
   - Shows past runs with timestamps and price tables
   - Calls `GET /api/history/:name?days=N`

**Styling:**
- `<script src="https://cdn.tailwindcss.com"></script>`
- Black and white shadcn-inspired: `bg-white`, `border`, `rounded-lg`, `text-sm`
- Monospace for prices: `ui-monospace, monospace`

**JavaScript:**
- All fetch calls to `/api/...`
- `esc(s)` helper: creates a div element, sets `textContent = s`, reads back `innerHTML` — safe escaping
- `renderResults(data)` builds HTML strings using `esc()` for all dynamic values
- `loadPois()` on page load to populate dropdowns and list
- `compare-date` input defaults to today

**Security note:** All dynamic content MUST be escaped through `esc()` before insertion. The `esc()` function:
```javascript
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
```

Every place where user data or API response data appears in HTML strings must use `esc(value)` — never raw interpolation.

Product URLs in the results table should be rendered as: `<a href="${esc(p.url)}" target="_blank" rel="noopener">view</a>`

- [ ] **Step 2: Verify file exists**

```bash
ls src/web/public/index.html
```

- [ ] **Step 3: Commit**

```bash
git add src/web/public/index.html
git commit -m "feat: add web dashboard frontend — POI management, compare, results, history"
```

---

### Task 3: Build and End-to-End Verification

**Files:** None new (verification only)

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: `dist/web/server.js`, `dist/web/api.js`, `dist/web/public/index.html` all exist.

- [ ] **Step 2: Verify dist structure**

```bash
ls dist/web/server.js dist/web/api.js dist/web/public/index.html
```

- [ ] **Step 3: Start server and test API**

```bash
node dist/web/server.js &
sleep 1
curl -s http://localhost:17890/api/pois | head -20
curl -s http://localhost:17890/ | head -5
kill %1
```

Expected: `/api/pois` returns JSON array, `/` returns HTML starting with `<!DOCTYPE html>`.

- [ ] **Step 4: Run all existing tests**

```bash
npx vitest run
```

Expected: All 40 tests pass (web server has no unit tests — it's integration-tested manually).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify web dashboard build and integration"
```
