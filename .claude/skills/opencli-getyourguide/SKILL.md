---
name: opencli-getyourguide
description: Execute and troubleshoot opencli getyourguide commands for GetYourGuide activities — search, detail, pricing, probe. Use when the user mentions GetYourGuide, GYG, getyourguide.com, or provides a GYG activity URL (pattern `/city-l{id}/title-t{activityId}/`) or the trailing `t{N}` activity ID; also use when opencli-router dispatches a GYG task or a tours / compare workflow targets the getyourguide platform.
---

# opencli-getyourguide

<!-- Platform skill metadata — grep-friendly. Keep these 5 fields current. -->
- **Platform**: `getyourguide`
- **Owner**: TODO — assign a maintainer (prefilled scaffold by Ryan from source code)
- **Strategy**: `BROWSER_BRIDGE` (GYG is SSR, no public API). Verify Browser Bridge with `opencli doctor`.
- **Domain**: `getyourguide.com`
- **Source**: `src/clis/getyourguide/` (`search.ts`, `detail.ts`, `pricing.ts` — plus `probe.ts` and `probe2.ts` debug helpers)

## Identifiers

- GYG activity IDs are **numeric**, extracted from the trailing `t{N}` segment of the URL.
- Canonical URL: `https://www.getyourguide.com/<city>-l{cityId}/<slug>-t{activityId}/`.
- `parseActivityId` in `src/clis/getyourguide/detail.ts` accepts either the full URL or the bare numeric ID — no need to pass the whole URL if you already have the trailing number.
- City prefix (`l{cityId}`) is separate from activity ID and not used by any command directly — it only shows up in search result URLs.

## Commands

### `search`
```bash
opencli getyourguide search-activities "<query>" --limit <N> -f json
```
Browser Bridge DOM extraction; expect ~10s. Returns `{ id, title, price, rating, review_count, url }[]`. Rating pattern on result cards is `4.3(1,032)` — the scraper parses both score and review count from that string.

### `detail`
```bash
opencli getyourguide get-activity <id-or-url> -f json
```
- Title from `h1`; description from `meta[name="description"]`.
- **Language dropdown**: the detail scraper auto-clicks the language button (matches English / 日本語 / 中文 / 한국어 / Français / Deutsch / Español / Italiano / Thai / Vietnamese / etc.) and enumerates available language options. This is a variant axis GYG buries in UI — it's part of your package matrix.
- Generic dropdown walker runs after the language pass to catch passenger-tier / vehicle / other variants.

### `pricing`
```bash
opencli getyourguide get-pricing-matrix <id-or-url> --days 7 -f json
```
Per-**variant** × per-date matrix. Flow:
1. Click "Check availability" (the sticky CTA) to open the datepicker.
2. For each target date, click the cell whose `aria-label` matches `"Weekday, Month Day, Year"` (e.g. `Saturday, April 25, 2026`).
3. Wait for the variants pane to re-render, scrape per-variant price.
4. Re-open the datepicker between dates — after the first selection, the CTA is replaced by a date input that re-opens the picker on click.

The datepicker **does** embed a "special price" badge per day, but the scraper ignores it — those badges are promotional and don't reflect the real per-variant price that materializes after selection.

### `probe` / `probe2` (debug)
```bash
opencli getyourguide probe <url>    # dump raw DOM for pricing extraction
opencli getyourguide probe2 <url>   # DOM state after picking a date
```
Debug-only. Use when pricing breaks and you need to see whether the "Check availability" button / datepicker selectors changed.

### `trending`
Not supported on GYG. Do not offer this command.

## Quirks

- **Language is a first-class variant**: GYG's UX nests language inside a button rather than a price matrix cell. The scraper pulls it separately — your output will have more "variants" than a naïve price-matrix scrape would suggest.
- **Datepicker re-opens differently after first selection**: the initial button literally reads "Check availability"; after a date is picked, it becomes a date input. The pricing scraper handles both but keep this in mind when writing probe scripts.
- **Lazy card images**: search cards lazy-load images; waiting for the image is NOT a reliable proxy for "card ready". The scraper keys off `-t\d+` URL matching instead.
- **"Top pick" / "Booked N times" badges**: these get stripped from titles with a regex — if titles look polluted, check whether GYG added a new badge format.

## Fallback playbook

When `opencli getyourguide get-pricing-matrix <id>` fails or returns empty:
1. **Retry once.** The datepicker click sequence is fragile to render jitter.
2. **Fall back to `detail`** via `node dist/cli.js tours ingest-from-detail getyourguide <id>` — detail returns a less granular package list but is enough for coverage tracking.
3. **Snapshot replay** from `data/snapshots/getyourguide-<id>-*.json` with `tours ingest-from-snapshot getyourguide <file>`.
4. **Manual capture** via the `browse` skill → navigate, select a date, save JSON matching `PricingRunRaw` → `tours ingest-snapshot`.

## Known failure modes

- **Empty variants after date click**: the variant pane sometimes renders behind a modal / overlay on first visit. The scraper waits, but if GYG tightens the animation, the first date will be empty. Symptom: variant count = 0 for date[0] but normal for dates[1..6].
- **Language dropdown not found**: on some single-language tours the language button is absent — `languages: []` is the expected output, not a failure.
- **Currency inconsistency**: prices appear in whatever currency the Browser Bridge cookie pins. Pin to a canonical currency per environment if you need cross-run comparability.

## Touchpoints

- `src/clis/getyourguide/search.ts` — card URL regex (`-t\d+`), title badge stripping
- `src/clis/getyourguide/detail.ts` — `parseActivityId`, language dropdown handler, generic variant walker
- `src/clis/getyourguide/pricing.ts` — datepicker open/re-open, aria-label date click, variant scrape
- `src/clis/getyourguide/probe.ts` / `probe2.ts` — debug-only DOM dumps

After any change: `npm run build`.

## I/O Schema

Canonical reference: **`docs/io-schemas.md`** — input args, output JSON shapes, DB column mappings.

**GYG-specific nuances**:
- **Language is a first-class axis**: `get-activity` / `get-packages` may return more `packages[]` entries than a naïve "package matrix" would — one per language option. Store under `packages.available_languages` (JSON array) rather than duplicating SKUs.
- `get-pricing-matrix` returns per-variant × per-date where "variant" combines language + passenger tier.
- No dedicated `trending` — skip that section when inserting.

**Writes when called via tours pipeline**: `activities`, `packages`, `skus`, `sku_observations` — same as other platforms. Use the `languages` array from `get-activity` output to populate `packages.available_languages` JSON.
