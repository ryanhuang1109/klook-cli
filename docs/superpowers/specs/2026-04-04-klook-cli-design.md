# klook-cli Design Spec

## Overview

A CLI tool for querying Klook.com activity/ticket data, built as both an **opencli plugin** and a **standalone CLI**. Primary goal: explore what opencli's Browser Bridge can do using Klook as the test case. Secondary goal: provide structured JSON output for AI agents.

## Architecture

```
klook-cli/
├── src/
│   ├── clis/klook/              # opencli adapter format
│   │   ├── search.ts            # Activity search
│   │   ├── trending.ts          # City trending activities
│   │   └── detail.ts            # Full activity info + pricing
│   ├── shared/
│   │   ├── types.ts             # Shared types (Activity, Package, Price, etc.)
│   │   └── parsers.ts           # Page/API response parsing logic
│   └── cli.ts                   # Standalone CLI entry (bin: "klook")
├── opencli-plugin.json          # opencli plugin manifest
├── package.json                 # Dual entry: bin + opencli plugin
├── tsconfig.json
└── vitest.config.ts
```

### Key Decisions

- **opencli as peer dependency** — user installs opencli first, then `opencli plugin install` for this plugin
- **Standalone CLI entry** — `cli.ts` imports opencli runtime to init Browser Bridge, then calls the same adapter logic
- **All commands use COOKIE strategy** — via opencli Browser Bridge, reusing Chrome login session
- **Output** — default `table` for humans, `--format json` for AI agents

## Commands

### 1. `klook/search` — Activity Search

```
klook search <query> [--city <city>] [--category <cat>] [--limit 20] [--sort price|rating|popular]
```

**Flow:**
1. Navigate to `https://www.klook.com/search/?query=<query>` via Browser Bridge
2. Apply `--city` / `--category` filters if provided
3. Auto-scroll to load more results
4. Extract activity list from DOM / bootstrap data / API response

**Output columns:** `rank`, `title`, `price`, `currency`, `rating`, `review_count`, `category`, `city`, `url`

**Parsing strategy (multi-layer fallback, same as opencli/coupang):**
1. Intercept XHR/fetch API responses for structured JSON
2. Parse `__NEXT_DATA__` / bootstrap globals
3. Parse `<script type="application/ld+json">`
4. DOM scraping as final fallback

### 2. `klook/trending` — City Trending Activities

```
klook trending <city> [--limit 10] [--category attractions|tours|transport]
```

**Flow:**
1. Navigate to `https://www.klook.com/city/<city>/` or equivalent destination page
2. Extract trending/recommended sections from page
3. Parse ranking data

**Output columns:** `rank`, `title`, `price`, `currency`, `rating`, `review_count`, `category`, `url`

### 3. `klook/detail` — Activity Detail + Pricing

```
klook detail <activity-id-or-url> [--date <YYYY-MM-DD>]
```

**Flow:**
1. Navigate to `https://www.klook.com/activity/<id>/`
2. If `--date` provided, select that date to load corresponding prices
3. Extract full activity information from page

**Output structure:**

```typescript
{
  // Basic info
  title: string;
  description: string;
  city: string;
  category: string;
  rating: number;
  review_count: number;
  images: string[];          // image URLs

  // Itinerary
  itinerary: {
    time: string;
    title: string;
    description: string;
  }[];

  // Packages with pricing
  packages: {
    name: string;
    description: string;
    inclusions: string[];
    exclusions: string[];
    price: number;
    currency: string;
    original_price: number | null;
    discount: string | null;
    date: string;             // selected date or default
    availability: string;
  }[];

  url: string;
}
```

**`--format` behavior:**
- `json` — full nested structure, best for AI agents
- `table` — summary view (basic info + package price table)
- `markdown` — full content, best for human reading

## Error Handling

Uses opencli's `CliError` hierarchy:

| Scenario | Error | Hint |
|----------|-------|------|
| Not logged in to Klook | `AuthRequiredError` | "Please log in to klook.com in Chrome" |
| No results found | `EmptyResultError` | "Try different keywords or city" |
| Page structure changed | `SelectorError` | "Klook UI may have changed, please report" |
| Browser Bridge not running | `BrowserConnectError` | "Run `opencli doctor` to check setup" |

## AI Agent Usage

AI agents invoke via shell and parse JSON:

```bash
# Search
klook search "Tokyo teamLab" --format json --limit 5

# Get detail with pricing for a specific date
klook detail 1234 --format json --date 2026-05-15
```

Structured JSON output enables AI agents to:
- Compare activities across destinations
- Find best-priced options
- Summarize activity details for users

## Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js >= 20 or Bun >= 1.0
- **Dependencies:** opencli (peer), commander (standalone CLI)
- **Testing:** Vitest
- **Browser:** opencli Browser Bridge (Chrome extension)

## Out of Scope (for now)

- Local price tracking / storage
- Booking / purchasing actions
- MCP server integration
- User review content extraction
