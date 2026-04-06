# Compare & Monitor Design Spec

## Overview

Add a competitor monitoring system to klook-cli. Users configure POIs (Points of Interest) to monitor, then run `compare` to search all 4 platforms, cluster similar products via LLM, standardize pricing, and track changes over time in SQLite.

## POI Configuration

POIs are stored in `~/.klook-cli/pois.json`:

```json
[
  {
    "name": "Mt Fuji day tour",
    "keywords": ["Mt Fuji day tour", "富士山一日遊"],
    "platforms": ["klook", "trip", "getyourguide", "kkday"],
    "date_range": "next_7_days"
  }
]
```

### POI Commands

```bash
klook-cli poi add "Mt Fuji day tour" --keywords "Mt Fuji day tour,富士山一日遊"
klook-cli poi add "USJ tickets" --keywords "Universal Studios Japan,USJ admission" --platforms klook,kkday,getyourguide
klook-cli poi list
klook-cli poi remove "Mt Fuji day tour"
```

- `--keywords`: comma-separated search terms. Different platforms may respond better to different keywords (Chinese vs English, full name vs abbreviation). All keywords are searched per platform, results are deduplicated.
- `--platforms`: comma-separated platform list. Defaults to all 4.
- `--date_range`: not implemented in v1 — compare always uses a single `--date` or today.

## Compare Command

```bash
# Single POI
klook-cli compare "Mt Fuji day tour" --date 2026-04-15

# All configured POIs
klook-cli compare --all --date 2026-04-15

# Save results to SQLite for historical tracking
klook-cli compare "Mt Fuji day tour" --date 2026-04-15 --save

# Output formats
klook-cli compare "Mt Fuji day tour" --format json    # structured JSON
klook-cli compare "Mt Fuji day tour" --format markdown # human-readable (default)
```

### Compare Flow

1. **Load POI config** — read `~/.klook-cli/pois.json`, find matching POI by name
2. **Search all platforms in parallel** — for each platform, run all keywords, deduplicate by URL
3. **Collect raw results** — array of `{ platform, title, price, rating, review_count, url }`
4. **Call OpenRouter LLM** — send all results + clustering prompt, get back grouped comparison
5. **Output** — render as markdown (default) or JSON
6. **Optionally save** — write to SQLite `~/.klook-cli/history.db`

### LLM Clustering

**API:** OpenRouter (`https://openrouter.ai/api/v1/chat/completions`)

**Model:** configurable, default `anthropic/claude-sonnet-4` (good balance of quality and cost)

**System prompt:**

```
You are a travel product analyst. Given search results from multiple platforms for the same POI, group them into clusters of similar/equivalent products.

Rules:
- Group products that visit the same set of attractions with similar duration
- Convert all prices to USD (use approximate current rates, state rates used)
- For each group, identify the cheapest and best-rated option
- Flag notable differences (includes hotel pickup, meal, express pass, etc.)
- Output valid JSON matching the schema below. No other text.
```

**Output schema:**

```typescript
interface CompareResult {
  query: string;
  date: string;
  groups: CompareGroup[];
  currency_rates_used: string;
}

interface CompareGroup {
  group_name: string;
  description: string;
  products: CompareProduct[];
  cheapest: string;
  best_rated: string;
}

interface CompareProduct {
  platform: string;
  title: string;
  price_usd: number | null;
  price_original: string;
  rating: string;
  review_count: string;
  url: string;
  notes: string;
}
```

### Markdown Output Format

```markdown
## Mt Fuji Day Tour — 2026-04-15

### Group 1: Classic 6-Spot Day Tour (Tokyo departure)
> Lake Kawaguchi + Oshino Hakkai + Outlets, ~10 hours

| Platform | Price (USD) | Original | Rating | Reviews | Notes |
|----------|-------------|----------|--------|---------|-------|
| Trip.com | $41.88 | US$41.88 | 4.8 | 5,422 | cheapest |
| KKday | $45.06 | US$45.06 | 4.8 | 5,561 | |
| Klook | $51.45 | HK$519 | 4.8 | 28,200+ | most reviewed |

Best price: Trip.com ($41.88) | Best rated: Klook (4.8, 28K+ reviews)

### Group 2: Mt Fuji + Hakone Tour
...
```

## History Storage

SQLite database at `~/.klook-cli/history.db`.

### Schema

```sql
CREATE TABLE compare_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poi_name TEXT NOT NULL,
  date TEXT NOT NULL,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  result_json TEXT NOT NULL
);

CREATE INDEX idx_compare_runs_poi ON compare_runs(poi_name, date);
```

### History Command

```bash
klook-cli compare-history "Mt Fuji day tour" --days 7
```

Queries the last 7 days of saved runs for that POI and shows price changes:

```
Mt Fuji day tour — price changes (last 7 days)

Classic 6-Spot Day Tour:
  Trip.com:  $41.88 → $41.88 → $43.20 (↑ $1.32 on 04/14)
  KKday:     $45.06 (no change)
  Klook:     $51.45 (no change)
```

## Environment Configuration

```bash
# Required
export OPENROUTER_API_KEY=sk-or-...

# Optional: override model
export OPENROUTER_MODEL=anthropic/claude-sonnet-4
```

Or in `~/.klook-cli/config.json`:

```json
{
  "openrouter_api_key": "sk-or-...",
  "openrouter_model": "anthropic/claude-sonnet-4"
}
```

Config file takes precedence over env var.

## File Structure

```
src/
├── compare/
│   ├── compare.ts         # compare command: orchestrates search → LLM → output
│   ├── llm.ts             # OpenRouter API call wrapper
│   ├── store.ts           # SQLite read/write for history
│   └── formatter.ts       # Markdown + JSON output formatting
├── poi/
│   └── poi.ts             # POI CRUD (add/list/remove), reads/writes pois.json
├── clis/...               # existing platform adapters (unchanged)
└── shared/
    ├── types.ts           # add CompareResult, CompareGroup, CompareProduct types
    └── parsers.ts         # unchanged
```

## Dependencies

- `sql.js` — pure JS SQLite (no native compilation, works everywhere)
- `node:fetch` — already available in Node 20+ for OpenRouter API calls

## Out of Scope (v1)

- Date range comparison (compare across multiple dates in one run)
- Automatic product detail fetching (only search results, not detail pages)
- Webhook/notification on price changes
- Web dashboard
