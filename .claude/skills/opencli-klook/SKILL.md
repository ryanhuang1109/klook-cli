---
name: opencli-klook
description: Execute and troubleshoot opencli klook commands — search, detail, pricing, trending — on klook.com activities. Use when the user mentions Klook, 客路, klook.com, or provides a numeric Klook activity ID (e.g. 151477, 93901); also use when opencli-router dispatches a Klook task or when a tours / compare workflow targets the klook platform.
---

# opencli-klook

<!-- Platform skill metadata — grep-friendly. Keep these 5 fields up to date. -->
- **Platform**: `klook`
- **Owner**: Ryan Huang (ryan.huang@klook.com) — reference template
- **Strategy**: `PUBLIC` (uses klook.com public search API; no Browser Bridge needed)
- **Domain**: `klook.com`
- **Source**: `src/clis/klook/` (`search.ts`, `detail.ts`, `pricing.ts`, `trending.ts`)

## Identifiers

- Klook activity IDs are **numeric**, e.g. `151477`, `93901`.
- Search results return `id` directly; `detail` and `pricing` take the ID as the positional arg.
- Canonical URL shape: `https://www.klook.com/en-US/activity/<id>-<slug>/` — the slug is cosmetic and may be omitted.

## Commands

### `search`
```bash
opencli klook search-activities "<query>" --limit <N> -f json
```
Fast (<1s) because it hits the public API. Returns `{ id, title, price, rating, review_count, url }[]`.

### `detail`
```bash
opencli klook get-activity <id> -f json
```
Returns packages, itinerary, sections, and basic pricing. Use when you need itinerary text or package list but not the full date-matrix pricing.

### `pricing` (Klook-specific)
```bash
opencli klook get-pricing-matrix <id> --days 7 -f json
```
Klook has a **dedicated** `pricing` command — the other three platforms don't. It clicks each date in the calendar and returns a `package × date` price matrix. Use this when the tours pipeline asks for `sku_observations`-shaped output.

### `trending`
```bash
opencli klook list-trending "<city>" -f json
```

## Quirks

- Public API means rate-limit risk is lower than Browser Bridge platforms — it's usually the first platform to try when benchmarking.
- `detail` sometimes returns fewer packages than the live page shows for multi-region activities; if completeness matters, prefer `pricing` which walks the calendar explicitly.
- Locale: results default to en-US. The adapter hard-codes this; changing locale requires editing `src/clis/klook/search.ts`.

## Fallback playbook

When `opencli klook get-pricing-matrix <id>` fails or returns empty:
1. **Retry once.** Transient network issues are common.
2. **Try `detail` as fallback** via `node dist/cli.js tours ingest-from-detail klook <id>` — uses the detail endpoint to fill SKU rows when pricing scraper breaks.
3. **Snapshot replay.** If a fresh JSON dump already exists under `data/snapshots/klook-<id>-*.json`, use `tours ingest-from-snapshot klook <file>` instead of re-hitting the API.
4. **Manual capture.** Only if 1–3 all fail: use the `browse` skill to navigate `https://www.klook.com/en-US/activity/<id>/`, extract package+price rows, save JSON matching `PricingRunRaw`, then `tours ingest-snapshot`.

## Known failure modes

- **Empty search results for generic queries**: the public API ranks by commercial signal, not text match. If a well-known activity doesn't surface, try a more specific keyword or look up the ID directly.
- **Price drift vs live page**: the API sometimes lags promotional prices by a few minutes; flag via `tours set-sku-review-status <id> flagged --note "API lag vs live"` instead of re-scraping immediately.

## Touchpoints

Edit these files to change skill-observed behavior:
- `src/clis/klook/search.ts` — query, locale, result shape
- `src/clis/klook/detail.ts` — package/itinerary extraction
- `src/clis/klook/pricing.ts` — calendar walk, date-matrix shape
- `src/clis/klook/trending.ts` — trending city endpoint

After any change: `npm run build` (the symlink at `~/.opencli/plugins/klook` picks up `dist/` automatically).
