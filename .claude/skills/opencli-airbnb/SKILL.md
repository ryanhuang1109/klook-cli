---
name: opencli-airbnb
description: Execute and troubleshoot opencli airbnb commands for Airbnb Experiences — search, detail. Use when the user mentions Airbnb, Airbnb Experiences, airbnb.com, or provides an Airbnb experience URL (pattern `/experiences/{id}`) or numeric experience ID; also use when opencli-router dispatches an airbnb task or a tours / compare workflow targets the airbnb platform.
---

# opencli-airbnb

<!-- Platform skill metadata — grep-friendly. Keep these 5 fields current. -->
- **Platform**: `airbnb`
- **Owner**: klook-cli core team (ryan.huang@klook.com) — scrape logic maintained here; listing-page discovery owned by BD team (see `docs/colleague-handoff.md`)
- **Strategy**: `BROWSER_BRIDGE` (Airbnb is SSR + heavy React hydration with PerimeterX/Akamai bot protection; no public API)
- **Domain**: `airbnb.com`
- **Source**: `src/clis/airbnb/` (`search.ts`, `detail.ts` — pricing.ts not yet implemented)

## Status: v0.2 — city + supplier + cancellation working, currency manual, pricing pending

Validated 2026-04-27 against two experiences:
- `experience/121104` (Tokyo go-kart, no business name on listing)
- `experience/232900` (Kyoto Kimono, has business "Kiwami Fujinoka")

| Field | Status |
|---|---|
| Search results (title, rating, id, url) | ✅ |
| Detail title / rating / review_count | ✅ |
| **`city`** | ✅ Anchored on `[N] reviews\n<city>\n,\n · <category>` body-text pattern |
| **`category`** | ✅ Same anchor as city |
| **`supplier`** | ✅ Prefers business name from "Owner of <X>" / "Founder of <X>"; falls back to "Hosted by <Person>" if no business is listed |
| Packages (1 synthesized) | ✅ |
| Sections (15–20 captured) | ✅ |
| `cancellation_policy` | ✅ Clean — sibling-walker (`getSectionWalkerJs`) replaced the old `.closest('section')` over-capture |
| Currency | ⚠️ Browser Bridge cookie-pinned — see below |

**Known v0.2 gaps** to iterate on:
- **Pricing not implemented**: Airbnb prices per-person × per-time-slot, which doesn't map cleanly onto our `package × date` SKU shape. Decide the shape before writing `pricing.ts`.
- **Some experiences omit the city/category line entirely** (multi-location tours, very old listings) — `city`/`category` will be empty, which is correct behavior, not a regex bug.

## Currency: Browser Bridge cookie pin

**Airbnb does not expose currency in the experience URL or page DOM** (prices render as `$4,634` / `€42` / `¥800` with the locale symbol but no ISO code). The displayed currency is determined by the user's session cookie, which Airbnb sets via a footer dropdown on `airbnb.com`.

To control which currency the scraper sees:
1. Open `airbnb.com` in a real browser, scroll to the footer, click the language/currency selector, pick the currency you want (e.g. USD).
2. The choice persists as a cookie on `airbnb.com`.
3. Sync that cookie into the Browser Bridge session — use the `setup-browser-cookies` skill or copy cookies from your real browser into the headless profile.
4. Verify with `opencli airbnb search "test" --limit 1 -f json` — the price string should reflect the chosen currency.

**Important**: cookie state is per-session, so a cold Browser Bridge will revert to whatever default Airbnb negotiates from the request geo. For the daily tours routine to be deterministic, pin currency in the Browser Bridge cookie store before the first scrape of the day.

## Identifiers

- Airbnb experience IDs are **numeric** (e.g. `1234567`).
- Extracted from URLs matching `/experiences/{id}` via `parseExperienceId` in `src/clis/airbnb/detail.ts`. Accepts either a full URL or the bare numeric ID.
- Canonical URL: `https://www.airbnb.com/experiences/{id}`. Locale-prefixed variants like `/zh-tw/experiences/{id}` exist but are not the canonical form — the adapter does not currently rewrite them.

## Commands

### `search`
```bash
opencli airbnb search-activities "<query>" --limit <N> -f json
```
Browser Bridge; expect ~10–15s including hydration wait + autoscroll. Search URL pattern: `https://www.airbnb.com/s/<query>/experiences`. Returns `{ id, title, price, rating, review_count, url }[]`. Price string contains a currency symbol per locale (e.g. `$35`, `€42`).

### `detail`
```bash
opencli airbnb get-activity <id-or-url> -f json
```
- Title from `h1`; description from `meta[name="description"]`.
- **Host as supplier**: Airbnb experiences don't have a separate operator field — the host (`Hosted by <Name>`) maps to our `supplier` column.
- **Single synthetic package**: experiences usually offer one product (private/group is sometimes a variant axis). The detail scraper emits a single package built from the booking widget price + experience title; refine to fan into multiple packages once the variant model is observed.
- **Cancellation policy** is rendered as an explicit `h2` on Airbnb (cleaner than KKday/Trip), so the section walker + body-text fallback should both succeed.

### `pricing`
**Not yet implemented.** Airbnb experiences are priced per-person × per-time-slot, which doesn't map cleanly onto our existing `package × date` SKU shape. For now use `node dist/cli.js tours ingest-from-detail airbnb <id>` once that path is wired up, or capture pricing manually via the `browse` skill.

### `trending`
Not supported on Airbnb. Do not offer this command.

## Quirks

- **PerimeterX / Akamai bot protection**: this is the #1 risk. First scrape attempts may return a skeletal challenge page with no real content. If `search` returns 0 results on a known-valid keyword, refresh Browser Bridge cookies via `opencli doctor`, or open the URL in a real Chrome window with the `browse` skill to warm the session before retrying.
- **Heavy lazy hydration**: even after the initial HTML loads, Airbnb hydrates the search grid + booking widget over several seconds. The scraper waits 4–5s and autoscrolls; if you still get empty results, increase the wait.
- **Currency is cookie-pinned, not page-encoded**: see the dedicated "Currency" section above. The scraped `price` string reflects whatever currency the Browser Bridge session is logged into — set it deliberately before scraping.
- **City + category line is split across newlines with a stray comma**: innerText format is `"<N> reviews\n<city>\n,\n · <category>"`. Don't expect `<city> · <category>` to be on one line — the regex anchors on `[N] reviews\n` and tolerates the comma.
- **Some experiences omit the city/category line**: multi-location tours and older listings don't render this header chip. Empty `city`/`category` is expected, not a failure.
- **`supplier` is a fallback chain**: prefer the business name from "Owner of <X>" / "Founder of <X>"; only use the host's first name if no business is listed.
- **Reviews format varies**: Airbnb sometimes shows "★ 4.92 (127)" inline, sometimes "4.92 out of 5" on the booking card. The scraper tries both.
- **No itinerary on most experiences**: "What you'll do" is a free-text section, not a stepped timeline. The `itinerary[]` array is best-effort and often empty.
- **Section walker uses sibling-walk, not `.closest('section')`**: Airbnb groups several h2s under one `<section>` element ("Cancellation policy" + "Things to know" + "Guest requirements" + "Activity level"). The shared `getSectionWalkerJs()` helper walks siblings between a heading and the next heading, falling back to `closest()` only when the enclosing section has ≤3 headings. This gives clean, scoped cancellation policy text instead of the whole "Things to know" block.

## Fallback playbook

When `opencli airbnb get-activity <id>` fails or returns empty:
1. **Retry once.** Bot-challenge pages often clear on the second hit if cookies were warmed.
2. **`opencli doctor`** to refresh Browser Bridge cookies.
3. **Open the URL in `browse`** to manually warm the session and verify the page actually renders for your geo.
4. **Snapshot replay** from `data/snapshots/airbnb-<id>-*.json` (once any have been captured) with `tours ingest-from-snapshot airbnb <file>`.
5. **Manual capture** via the `browse` skill → save JSON matching `KlookDetail` shape → ingest.

## Known failure modes

- **Empty `title`**: the page hit a bot challenge — body text contains "Press & Hold" or a captcha widget instead of real content. Response: warm cookies via `opencli doctor`, then retry. Do not proceed with downstream ingest.
- **Title is correct but `packages[]` is empty**: the booking widget didn't hydrate before scrape. Response: increase `page.wait` in `src/clis/airbnb/detail.ts` or scroll past the sidebar to force render.
- **Region-locked experience**: some experiences only show price after geo-detection. Response: verify the experience is bookable from the Browser Bridge's geo, otherwise flag via `tours set-activity-review-status <id> flagged --note "region-locked"`.
- **Search returns stays cards mixed with experiences**: the URL `/experiences` filter sometimes leaks. The scraper filters on the `/experiences/<id>` URL pattern, so non-experience cards are dropped silently. Symptom: `limit=20` returns < 20 results on a busy keyword.

## Touchpoints

Edit these files to change skill-observed behavior:
- `src/clis/airbnb/search.ts` — search URL, card selector, result shape
- `src/clis/airbnb/detail.ts` — `parseExperienceId`, h1/meta extraction, packages synthesis, cancellation policy
- `src/clis/airbnb/pricing.ts` — TODO, not yet implemented

After any change: `npm run build` (the symlink at `~/.opencli/plugins/airbnb` picks up `dist/` automatically).

## I/O Schema

Canonical reference: **`docs/io-schemas.md`** — full input args, output JSON shapes, and DB column mappings.

**Airbnb-specific nuances**:
- **`supplier` = host name**: parsed from "Hosted by <Name>" body text, not a separate operator label like Klook.
- **`order_count` is empty**: Airbnb does not surface a "X+ booked" counter on experience pages. Don't expect this column to populate from this platform.
- **`packages[]` typically has 1 entry** (the experience itself). When refined, "Private experience" / "Group experience" become variant axes — store under `option_dimensions` rather than fanning into duplicate `packages` rows.
- **`cancellation_policy` (cross-platform field, Airbnb-specific extraction path)**: cleanly captured from the explicit "Cancellation policy" h2. Output is typically a single sentence describing the refund window (e.g. "Free cancellation up to 24 hours before the experience starts").

**Writes when called via tours pipeline**:
- `get-activity` → `activities` row (host as supplier, cancellation_policy populated, single synthetic package)
- `get-pricing-matrix` — not implemented; pipeline must use `tours ingest-from-detail` until pricing.ts is built.
