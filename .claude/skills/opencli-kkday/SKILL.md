---
name: opencli-kkday
description: Execute and troubleshoot opencli kkday commands for KKday activities — search, detail, pricing, probe. Use when the user mentions KKday, kkday.com, or provides a KKday product URL (pattern `/en/product/{id}`) or numeric product ID (e.g. 2247); also use when opencli-router dispatches a KKday task or a tours / compare workflow targets the kkday platform.
---

# opencli-kkday

<!-- Platform skill metadata — grep-friendly. Keep these 5 fields current. -->
- **Platform**: `kkday`
- **Owner**: TODO — assign a maintainer (prefilled scaffold by Ryan from source code)
- **Strategy**: `BROWSER_BRIDGE` (KKday is SSR; no public API).
- **Domain**: `kkday.com` (primary market zh-TW; `/en/` subpath used by the adapter)
- **Source**: `src/clis/kkday/` (`search.ts`, `detail.ts`, `pricing.ts` — plus `probe.ts` and `probe2.ts` debug helpers)

## Identifiers

- KKday uses **numeric product IDs** (e.g. `2247`).
- Extracted from URLs matching `/product/{id}` via `parseProductId` in `src/clis/kkday/detail.ts`. Accepts either a full URL or the bare numeric ID.
- Canonical URL: `https://www.kkday.com/en/product/{id}` — other locales swap `/en/` for `/zh-tw/`, `/ja/`, etc. The adapter targets the `/en/` variant.

## Commands

### `search`
```bash
opencli kkday search-activities "<query>" --limit <N> -f json
```
Browser Bridge; ~10s. Title selector prefers `[class*="title"], h2, h3`. Price regex matches multi-currency format (`US$55.80`, `TWD 1,200`, `HK$320`, `EUR 45`, `JPY 3,000`, `KRW 80,000`, `SGD 90`).

### `detail`
```bash
opencli kkday get-activity <id-or-url> -f json
```
- Title from `h1`; description from meta.
- **Package structure is richer than other platforms**: KKday groups packages under category tabs (Admission, Bundle, VIP) with `h3` package names. The detail scraper walks each tab and emits all packages — expect more rows than for a comparable Klook / Trip activity.
- **Booking counter**: KKday surfaces "X+ travelers booked" / "Sold X+" on the product page. The scraper captures this into `bookCount`. Useful for cross-platform demand comparison.

### `pricing`
```bash
opencli kkday get-pricing-matrix <id> --days 7 -f json
```
Per-**package** × per-date matrix:
- Enumerates `.option-item` elements — each is one package.
- Clicks "Select" on the package, which exposes a calendar with inline per-date "from" prices (e.g. `from 59.14`).
- The "from" price is the **minimum across sub-SKUs** within the package for that date, not a per-SKU price. If you need sub-SKU granularity, KKday doesn't expose it cleanly — flag and escalate.

### `probe` / `probe2` (debug)
```bash
opencli kkday probe <id>    # DOM dump for pricing reverse engineering
opencli kkday probe2 <url>  # no-click probe — navigate and read calendar
```
Debug-only. `probe2` is safer when you just want to inspect what the calendar looks like without perturbing state via the "Select" click.

### `trending`
Not supported on KKday. Do not offer this command.

## Quirks

- **"From" prices are minima, not exact**: unlike Klook's per-package `pricing` which can surface per-tier SKUs, KKday's calendar gives you the minimum for the package. Cross-platform SKU-level comparisons require normalization — don't compare KKday `from` directly against Klook adult/child tiers.
- **Locale subpath matters**: `/en/` returns English titles; `/zh-tw/` returns Chinese. The adapter pins `/en/` — if you pass a `/zh-tw/` URL, the scraper rewrites it.
- **Package category tabs are ordered UI**: tabs appear in a specific order (Admission → Bundle → VIP) and the scraper preserves it. If downstream tools dedupe by title, they may collapse legitimately-different packages that share a name but sit in different tiers.
- **Cookie/warm-up sensitivity**: the first Browser Bridge request after a cold bridge sometimes returns a skeletal page. Retry-once is typically sufficient; a full warm-up query is rarely needed.

## Fallback playbook

When `opencli kkday get-pricing-matrix <id>` fails or returns empty:
1. **Retry once.** Cold-bridge is the most common cause.
2. **Fall back to `detail`** via `node dist/cli.js tours ingest-from-detail kkday <id>` — captures package list + booking counter without walking the calendar.
3. **Try `probe2`** to confirm the calendar is actually rendering; if the calendar is visually present but the scraper can't find `.option-item`, KKday changed its class structure — open an issue.
4. **Snapshot replay** from `data/snapshots/kkday-<id>-*.json` with `tours ingest-from-snapshot kkday <file>`.
5. **Manual capture** via the `browse` skill → save JSON matching `PricingRunRaw` → `tours ingest-snapshot`.

## Known failure modes

- **Calendar shows date but scraper misses it**: KKday occasionally lazy-mounts the calendar after a package "Select" click. The scraper waits, but aggressive changes to their loading animation will break this; symptom is "package found, dates empty".
- **Booking counter missing**: not every product shows the counter. Missing `bookCount` is normal for newer products, not a scraper failure.
- **Currency mismatch vs Klook**: KKday defaults to the viewer's currency (via cookie), which may differ from Klook's en-US default. Normalize before cross-platform compare.

## Touchpoints

- `src/clis/kkday/search.ts` — multi-currency price regex, card selector
- `src/clis/kkday/detail.ts` — `parseProductId`, booking-counter regex, package tab walker
- `src/clis/kkday/pricing.ts` — `.option-item` enumeration, Select-click → calendar read
- `src/clis/kkday/probe.ts` / `probe2.ts` — debug-only DOM dumps

After any change: `npm run build`.
