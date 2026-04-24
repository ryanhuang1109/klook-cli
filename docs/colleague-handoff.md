# Colleague Handoff: Listing Discovery → Activity Ingestion

**Two teams, one pipeline:**

| Team | Owns | Deliverable |
|---|---|---|
| **BD / listing team** (colleagues) | Finding **which activities** to monitor on each platform by walking listing pages | Append rows to `data/golden/pricing-tna-planning.csv` with activity URL + listing provenance |
| **klook-cli core team** (us) | Deep scraping once we have activity URLs — `get-activity`, `get-packages`, `get-pricing-matrix`, tours DB upsert | Run `tours ingest-from-planning-csv` → populate `data/tours.db` → export CSV + report |

The handshake is the **planning CSV**. Colleagues append rows; we ingest. No chat, no sheets API, no custom integrations.

---

## Why this split

- Colleagues know how to walk a listing category page, clear cookie banners, click "Show more" 20 times, and extract the visible activity links — all platform-specific DOM work that belongs in their Claude-in-Chrome workflow.
- Core team owns the CLI adapters (`src/clis/<p>/*.ts`) and the canonical tours DB schema. Scraping a single URL cleanly + persisting cleanly is a different skill set.
- **Single source of truth**: the planning CSV. Both sides know where to read + write.

---

## CSV contract

File: `data/golden/pricing-tna-planning.csv` (checked into git).

### Columns 1–15 (existing, unchanged)

Legacy planning fields. Colleagues **don't need to fill** most of these when adding a newly-discovered activity — only the ones below are load-bearing.

**Must-fill for a new discovery row:**
- **Column 1 — `OTA`**: `Klook` / `Trip` / `Getyourguide` / `Kkday` (case-insensitive in practice)
- **Column 2 — `Main POI`**: the POI label used in the tours DB (e.g. `Mount Fuji`). Must match any existing POI grouping you want to fold into — or be a new POI name.
- **Column 11 — `Lowest_Price_AID`**: the **activity URL** on that platform (what our CLI parses to extract the numeric activity ID). Any of these work:
  - `https://www.klook.com/en-US/activity/93901-…/`
  - `https://www.trip.com/things-to-do/detail/92795279/`
  - `https://www.kkday.com/en/product/2247`
  - `https://www.getyourguide.com/fuji-lXXX/name-t12345/`

**Ignore (leave blank)**: Language / Tour Type / Group size / Meals / Departure City / Departure time / Check Date_Time / Price_USD / Price_Destination_Local. Our CLI fills these after scraping.

### Columns 16–19 (new, listing-discovery metadata)

**Optional but strongly recommended** — lets us trace where each activity came from:

| # | Column | What to put |
|---|---|---|
| 16 | `Listing_URL` | The listing / category page URL you found this activity on (e.g. `https://www.klook.com/en-US/search/bangkok-food-tour/`) |
| 17 | `Discovered_By` | Your name or team tag (e.g. `apac-bd-team`, `ryan`, `jake`) |
| 18 | `Discovered_At` | ISO date `YYYY-MM-DD` when you added this row |
| 19 | `Theme` | Optional sub-vertical keyword (e.g. `food tour`, `temple`, `day trip`) |

If you leave them blank, the ingest still works — you just lose the provenance trail.

---

## Colleague workflow (listing side)

1. **Pick a target**: platform + POI + theme (e.g. Klook × Bangkok × food tour).
2. **Run your listing-discovery skill** (you own these under `~/Downloads/skill batch/`):
   - `gyg-listing-scraper`, `kkday-listing-scraper`, or whatever you use
   - Output: list of activity URLs on that platform
3. **Append each discovered activity to the planning CSV**:
   - OTA, Main POI, `Lowest_Price_AID` (the activity URL) → required
   - Listing_URL / Discovered_By / Discovered_At / Theme → optional
   - Leave the in-between columns blank
4. **Commit & PR the CSV change** — keep the commit scoped (one PR per listing sweep).

Example row (pipe-separated for readability — actual CSV uses commas):

```
Klook | Mount Fuji | | | | | | | | | https://www.klook.com/en-US/activity/93901-.../ | | | | | https://www.klook.com/en-US/search/mt-fuji/ | apac-bd-team | 2026-04-24 | day trip
```

---

## Core team workflow (ingestion side)

After the CSV is merged:

```bash
# Smoke: what's in there?
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv --dry-run

# Full ingest (respects --platforms filter, --limit, --days):
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv \
  --platforms klook,trip,getyourguide,kkday --days 7

# Export + report:
node dist/cli.js tours export-csv
node dist/cli.js tours generate-report
```

The ingester:
- Parses each row via `loadGoldenCSV` (`src/tours/golden.ts`)
- Derives `(platform, activity_id)` from `Lowest_Price_AID`
- Dedupes by `(platform, activity_id)` — safe to have duplicate rows from different listing sweeps
- Calls `get-pricing-matrix` under the hood; falls back to `get-activity` if pricing scraper fails
- Logs `listing_url` + `discovered_by` alongside the ingest result for provenance

---

## Validation

Colleagues can self-check before PR:

```bash
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv \
  --dry-run --limit 5
```

Expected: each of your new rows appears with a parsed `(platform, activity_id)` + its POI + the listing URL. If a row shows no target, the activity URL didn't match our regex — check the URL format.

---

## What the CSV does NOT track

- **Price observations over time** — those go to `sku_observations` in `data/tours.db`, appended by each ingest run.
- **Review statuses** (verified / flagged / rejected) — those are `activities.review_status` in the DB, edited via `tours set-activity-review-status`.
- **Listing-page metadata** (filter codes, category taxonomy) — colleagues keep those in their own skill references; we don't need them.

The CSV is deliberately kept flat — it's the **target list**, not the results store.

---

## Anti-patterns to avoid

- ❌ **Don't edit existing rows**. Append only. If a POI name changed, add a new row; don't rewrite history.
- ❌ **Don't put activity IDs in columns other than `Lowest_Price_AID`**. The parser only looks at column 11.
- ❌ **Don't strip `?currency=…` query params**. Keep the URL as-found unless you know it's redirecting.
- ❌ **Don't paste Google Sheets export with merged cells** — export as CSV in Sheets → File → Download → Comma-separated values (.csv, current sheet).
- ❌ **Don't add columns beyond column 19**. Extending the schema needs a coordinated change in `src/tours/golden.ts`.

---

## Questions for the meeting

1. **Whose job is de-dup across listing sweeps?** If two colleagues find the same activity on different themes, both rows will land — the ingester dedupes by `(platform, activity_id)`, but the CSV itself will grow with duplicate rows. Is that OK or should we dedupe before PR?
2. **POI naming discipline**: if one sweep says `Mount Fuji` and another says `Mt. Fuji`, they become separate POIs in the DB. Should we publish a canonical POI list colleagues can pick from?
3. **Sweep cadence**: daily / weekly / on-demand? Drives how often we re-ingest.
4. **Failure handoff**: when our ingest fails for a URL a colleague added (bad URL, broken scraper), where does the feedback go — Slack / inline CSV comment / DB review_status?
