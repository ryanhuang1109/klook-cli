---
name: opencli-trip
description: Execute and troubleshoot opencli trip commands for Trip.com (Ctrip international) activities — search, detail, pricing, probe. Use when the user mentions Trip.com, 攜程, 携程, trip.com, Ctrip, or provides a Trip detail URL / numeric activity ID (e.g. 92795279); also use when opencli-router dispatches a Trip task or a tours / compare workflow targets the trip platform.
---

# opencli-trip

<!-- Platform skill metadata — grep-friendly. Keep these 5 fields current. -->
- **Platform**: `trip`
- **Owner**: TODO — assign a maintainer (prefilled scaffold by Ryan from source code)
- **Strategy**: `BROWSER_BRIDGE` (COOKIE flavor — Trip is SSR, no public API). Verify Browser Bridge with `opencli doctor`.
- **Domain**: `trip.com` (Ctrip international; the zh-CN sibling is `ctrip.com` but this adapter targets trip.com)
- **Source**: `src/clis/trip/` (`search.ts`, `detail.ts`, `pricing.ts` — plus `probe.ts` debug helper)

## Identifiers

- Trip activity IDs are **numeric**, e.g. `92795279`.
- Extracted from detail URLs matching `/things-to-do/detail/{id}`. `parseActivityId` in `src/clis/trip/detail.ts` accepts either a full URL or the bare numeric ID.
- Canonical URL shape: `https://www.trip.com/.../things-to-do/detail/{id}` — the city-slug prefix is cosmetic.

## Commands

### `search`
```bash
opencli trip search-activities "<query>" --limit <N> -f json
```
Browser Bridge navigation → DOM extraction. Expect ~10s including cookie warm-up. Returns `{ id, title, price, rating, review_count, url }[]`; price string includes currency code (e.g. `US$89`, `TWD 2,800`).

### `detail`
```bash
opencli trip get-activity <id-or-url> -f json
opencli trip get-activity <id> --compare-dates -f json   # also emits date matrix
```
- Title selector is `[class*="title_foot_warp_left"]`, falling back to `h1` / `document.title`. Promotional suffixes like `Promotion` / `Duration:` are stripped from the title.
- `--compare-dates` walks the 7-day calendar strip and returns inline "from" prices per date — cheaper than a full `pricing` call, but only gives the minimum across SKUs, not per-SKU rows.

### `pricing`
```bash
opencli trip get-pricing-matrix <id> --days 7 -f json
```
Extracts the **SKU × date** matrix:
- SKU tabs are `.m_ceil` elements inside `.sku_tab_ceil` with **numeric** id (date cells also use `.m_ceil` but their id is `YYYY-MM-DD` — the scraper discriminates on the id format).
- For each SKU, the scraper clicks the tab, waits for the 7-day ceil row to re-render, and reads the per-date "from" price.
- This is the canonical feed for `tours ingest`; prefer it over `detail --compare-dates` when you need per-SKU granularity.

### `probe` (debug)
```bash
opencli trip probe <id>
```
Dumps SKU/date DOM structure. Use only when the pricing scraper breaks and you suspect Trip changed its class names — do **not** rely on probe output in production pipelines.

### `trending`
Not supported on Trip. Do not offer this command.

## Quirks

- **Title pollution**: the title div sometimes concatenates promotion copy after the real title; the scraper slices on `Promotion` / `Duration:` but other suffixes may slip through — verify if titles look noisy.
- **Currency by geo**: the returned price string uses whatever currency Trip serves based on Browser Bridge locale. Do not assume USD. Downstream consumers must normalize.
- **SKU tabs vs date cells share class**: both are `.m_ceil`. Never iterate all `.m_ceil` without the numeric-id filter, or you'll treat dates as SKUs.
- **Cookie drift**: Browser Bridge cookie staleness is the #1 cause of empty search results. Re-run `opencli doctor` if search returns 0 items on a known-valid keyword.

## Fallback playbook

When `opencli trip get-pricing-matrix <id>` fails or returns empty:
1. **Retry once.** Cookie/timing flukes are the common cause.
2. **Fall back to `detail`** via `node dist/cli.js tours ingest-from-detail trip <id>` — fills SKU rows using the cheaper detail endpoint.
3. **Snapshot replay** from `data/snapshots/trip-<id>-*.json` with `tours ingest-from-snapshot trip <file>`.
4. **Manual capture** via the `browse` skill → navigate to the canonical URL → save JSON matching `PricingRunRaw` → `tours ingest-snapshot`.

If multiple Trip targets fail in the same run, the issue is almost always Browser Bridge / cookie — refresh it before retrying individual targets.

## Known failure modes

- **Empty SKU list**: Trip occasionally lazy-renders the SKU tab row if the page loaded while scrolled past it. The scraper scrolls to top before extracting — if you still get empty, check whether Trip redesigned `.sku_tab_ceil`.
- **Date cell "TBD"**: Some SKUs don't have availability for all 7 days; the scraper returns empty-string price rather than dropping the row. Downstream consumers should treat empty price as "unknown", not "zero".
- **Region redirect**: Requests from a non-en locale sometimes redirect to zh-CN Ctrip (DOM differs completely). Pin Browser Bridge to an en-US cookie.

## Touchpoints

- `src/clis/trip/search.ts` — search DOM extractor, currency regex
- `src/clis/trip/detail.ts` — `parseActivityId`, title selectors, `--compare-dates` handler
- `src/clis/trip/pricing.ts` — SKU tab enumeration, `.m_ceil` discriminator, date click loop
- `src/clis/trip/probe.ts` — debug-only DOM dump

After any change: `npm run build`. Symlink at `~/.opencli/plugins/trip` (if registered) picks up `dist/` automatically; otherwise run via `node dist/cli.js`.

## I/O Schema

Canonical reference: **`docs/io-schemas.md`** — input args, output JSON shapes, DB column mappings.

**Trip-specific nuances**:
- `get-activity --compare-dates` emits an **additional** field with the 7-day inline "from" price strip — useful when you want date coverage without the full SKU walk
- `get-pricing-matrix` output's `package_id` is the numeric SKU tab id (distinguishes from date cells that share the `.m_ceil` class)
- Currency is whatever Trip serves the Browser Bridge cookie → normalize before inserting into `skus.price_usd`

**Writes when called via tours pipeline**: same tables as Klook. `package_id` maps to `packages.platform_package_id`; keep it stable across runs so upserts don't create duplicates.
