# Web Dashboard Design Spec

## Overview

Add a local Express web server to klook-cli that provides a UI for BD colleagues to manage POIs, trigger cross-platform comparisons, and view results. Exposed via ngrok for remote access.

## Architecture

```
src/web/
├── server.ts          # Express server on port 17890
├── routes/api.ts      # REST API endpoints
└── public/
    └── index.html     # Single-page frontend (vanilla HTML + Tailwind CDN + shadcn style)
```

Server is started separately from the CLI: `node dist/web/server.js`. It imports the same modules (`poi.ts`, `compare.ts`, `store.ts`) directly — no subprocess calls for the web layer.

## REST API

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| GET | `/api/pois` | — | `POI[]` |
| POST | `/api/pois` | `{name, keywords: string[], platforms: string[]}` | `{ok: true}` or `{error: string}` |
| DELETE | `/api/pois/:name` | — | `{ok: true}` or `{error: string}` |
| POST | `/api/compare` | `{name, date?, save?}` | `CompareResult` JSON |
| GET | `/api/history/:name?days=7` | — | `HistoryRow[]` |

### Compare endpoint behavior

`POST /api/compare` is long-running (searches 4 platforms + LLM call, can take 1-3 minutes). The endpoint runs the full `runCompare()` and streams nothing — the frontend shows a loading spinner and waits for the JSON response. Timeout set to 5 minutes.

## Frontend (Single HTML Page)

### Style

- Tailwind CSS via CDN (`<script src="https://cdn.tailwindcss.com">`)
- Black and white, shadcn-inspired: `bg-white`, `border`, `rounded-lg`, `shadow-sm`, monospace for data
- No framework — vanilla HTML + JS + fetch API

### Layout (4 sections)

**① POI Management (top-left card)**
- Table listing all POIs: name, keywords (comma-joined), platforms (badges), delete button (X)
- Add POI form at bottom: name input, keywords textarea, platform checkboxes (klook/trip/getyourguide/kkday), Add button

**② Compare Controls (top-right card)**
- POI dropdown (populated from /api/pois)
- Date input (type="date", defaults to today)
- "Run Compare" button
- Loading spinner during comparison

**③ Results (main area, below controls)**
- Rendered after compare completes
- One card per group: group_name as heading, description as subtitle
- Table per group: Platform | Price (USD) | Original | Rating | Reviews | Notes
- Each URL is a clickable link
- Footer shows cheapest + best_rated per group
- Currency rates at bottom

**④ History (collapsible section)**
- Select a POI → shows list of past runs with timestamps
- Each run expandable to show the grouped price table
- Shows price changes if multiple runs exist

## Dependencies

- `express` — HTTP server
- `@types/express` — TypeScript types (dev)

No other new dependencies. Tailwind loaded via CDN.

## Startup

```bash
# Start web server
node dist/web/server.js
# → Listening on http://localhost:17890

# Expose via ngrok
ngrok http 17890
# → https://xxxx.ngrok-free.app (share with BD colleagues)
```

Add npm script: `"web": "node dist/web/server.js"` to package.json.

## Port

17890 — chosen to avoid conflicts with common dev ports (3000, 5173, 8080, etc.).

## Out of Scope

- Authentication (ngrok free tier has a warning page, enough for internal use)
- WebSocket/SSE for real-time progress (compare just blocks and returns)
- Multi-user concurrent compare (sequential is fine for now)
- Dark mode
