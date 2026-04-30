# Travel Competitor Monitor — Claude Code Instructions

You have access to a travel activity CLI that searches and compares prices across 4 platforms: Klook, Trip.com, GetYourGuide, and KKday.

## Skills (start here for platform / workflow tasks)

Platform-specific and cross-platform playbooks live as skills under `.claude/skills/`:

| Skill | Purpose | Owner |
|---|---|---|
| `opencli-router` | Dispatches any opencli / OTA request to the right specialist | shared |
| `opencli-klook` | Klook commands + quirks (reference template) | Ryan Huang |
| `opencli-trip` | Trip.com commands + quirks | TODO |
| `opencli-getyourguide` | GetYourGuide commands + quirks | TODO |
| `opencli-kkday` | KKday commands + quirks | TODO |
| `opencli-airbnb` | Airbnb Experiences commands + quirks | klook-cli core team |
| `opencli-routine` | Orchestrator that delegates to opencli-scan / opencli-pricing per (POI, platform) target | shared |
| `opencli-compare-poi` | Cross-platform POI compare workflow | shared |

When a user mentions a specific platform or workflow, invoke the matching skill before running commands. `grep "^- \*\*Owner\*\*:" .claude/skills/*/SKILL.md` to find the maintainer of any platform skill.

To add a skill for a **new** platform (e.g. Viator), see `docs/skill-template-platform.md`. Existing platform owners should fill the TODOs in their stub (`opencli-trip` / `opencli-getyourguide` / `opencli-kkday`) using `opencli-klook` as the reference.

## Available Commands

Old names (`search` / `detail` / `pricing` / `trending`, `poi add`, `compare`, `compare-history`) still work as aliases — you will not break scheduled routines or existing scripts. Full command reference: `docs/platform-capabilities.md`.

### Search activities on a single platform

```bash
opencli klook search-activities "<keyword>" --limit <N> -f json
opencli trip search-activities "<keyword>" --limit <N> -f json
opencli getyourguide search-activities "<keyword>" --limit <N> -f json
opencli kkday search-activities "<keyword>" --limit <N> -f json
```

### Get activity payload (title, packages, itinerary, sections, rating)

```bash
opencli klook get-activity <id> -f json
opencli trip get-activity <id> -f json
opencli getyourguide get-activity <id-or-url> -f json
opencli kkday get-activity <id> -f json

# Trip-specific: inline 7-day min prices
opencli trip get-activity <id> --compare-dates -f json
```

### Get packages only (narrow projection, lighter payload)

```bash
opencli <platform> get-packages <id> -f json
```

### Get pricing matrix (package/SKU × date, 7 days)

```bash
opencli <platform> get-pricing-matrix <id> --days 7 -f json
```

### Cross-platform AI comparison

```bash
node dist/cli.js list-pois
node dist/cli.js compare-poi "<POI>" --date <YYYY-MM-DD> --save -f json
node dist/cli.js compare-poi --all --date <YYYY-MM-DD> --save -f json
node dist/cli.js get-poi-price-history "<POI>" --days 7
```

### Manage POIs

```bash
node dist/cli.js add-poi "<name>" --keywords "<kw1>,<kw2>" --platforms klook,trip,getyourguide,kkday
node dist/cli.js list-pois
node dist/cli.js remove-poi "<name>"
```

## Important Notes

- Klook search uses a public API and is fast (<1s). Other platforms use Browser Bridge and take ~10s each.
- Always use `-f json` when you need to parse the output programmatically.
- The `compare-poi` command searches all platforms and calls an LLM to cluster results. It can take 1-3 minutes.
- Activity IDs come from search results. All four platforms use numeric IDs — Klook (e.g., 93901), KKday product IDs (e.g., 2247), Trip.com detail IDs (e.g., 92795279), GetYourGuide `t{N}` trailing IDs (e.g., 12345 from `/city-l234/slug-t12345/`). Adapters' `parseActivityId`/`parseProductId` accept either the bare ID or the full URL.
- Strip any "Update available" lines from opencli output before parsing JSON.

## Workflow for User Requests

When users ask about travel activities or prices:

1. **Search** the relevant platforms to find activities
2. **Get details** for specific activities if the user wants itinerary/packages/pricing
3. **Compare** across platforms if the user wants to find the best deal
4. **Present results** in a clear table format with platform, price, rating, and links

When users ask you to monitor or track prices:

1. **Add a POI** with relevant keywords (`add-poi`)
2. **Run `compare-poi`** with `--save` to store the baseline
3. Explain they can run `compare-poi` again later (or via cron) to track changes

## Tours Pipeline (scheduled routine workflow)

The tours module turns raw scraper output into a canonical three-tier schema
(Activity → Package → SKU) stored in `data/tours.db`, then exports to the
planning CSV format and an HTML report. This is the pipeline a scheduled
routine should drive.

### Canonical schema

- **Activity** — one per (platform, product_id). Identified by `canonical_url`.
- **Package** — variant within an activity (language bundle, group size, meals).
- **SKU** — `(package × travel_date)`. Price lives here. Daily observations are
  appended to `sku_observations` so history never overwrites.

### Core commands

Old terse names (`ingest`, `export`, `report`, `review-sku` …) still work as aliases. Full reference: `docs/platform-capabilities.md`.

```bash
# Ingest one activity (runs opencli <platform> get-pricing-matrix under the hood)
node dist/cli.js tours ingest-pricing <platform> <activity-id> --poi "<POI>" --days 7

# Bulk: read all (platform, activity-id) pairs from the planning CSV
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv \
  --platforms klook,trip --days 7

# Ingest from a previously saved JSON snapshot (skips scraping — useful when blocked)
node dist/cli.js tours ingest-from-snapshot klook data/snapshots/<file>.json \
  --poi "Mount Fuji" --url <canonical-url>

# Export DB to CSV matching the planning sheet
node dist/cli.js tours export-csv

# Generate HTML coverage/completeness report (writes latest.html)
node dist/cli.js tours generate-report

# List activities currently in the DB
node dist/cli.js tours list-activities --platform klook --poi "Mount Fuji"

# Mark data as reviewed (feedback mechanism)
node dist/cli.js tours set-sku-review-status <sku-id> verified --note "checked on live site"
node dist/cli.js tours set-activity-review-status <activity-id> rejected --note "wrong POI"

# Cross-platform match from a URL (URL-first lookup, LLM-ranked)
node dist/cli.js tours find-cross-platform-match "https://www.klook.com/en-US/activity/151477" \
  --to trip -f json
```

### Routine workflow (what a scheduled Claude Code run should do)

See the **`opencli-routine`** skill (`.claude/skills/opencli-routine/SKILL.md`)
for the orchestration logic: it decides per (POI, platform) target whether to
run `opencli-scan`, `opencli-pricing`, or both — and delegates to those skills.
The routine does not implement scan or pricing inline.

### Feedback loop

Human feedback enters via the `tours review-sku` / `tours review-activity`
commands. Review statuses: `unverified` (default), `verified`, `flagged`,
`rejected`. Routines consult these before the next run so mistakes aren't
repeated. A weekly export of flagged rows should be used to tune the
normalizer heuristics in `src/tours/normalize.ts`.

### Verification

- **Golden CSV** (`data/golden/pricing-tna-planning.csv`) is the reference
  truth for (platform, activity_id) coverage and expected POIs.
- **Schema validation**: the normalizer enforces canonical types via Zod.
- **Completeness report**: every `tours report` run surfaces which fields are
  missing per platform — this is the first thing to inspect after a run.
- **Snapshot retention**: every real ingest writes `data/snapshots/<platform>-<id>-<timestamp>.json`
  so failures can be replayed without re-scraping.

### Storage

- Default: SQLite at `data/tours.db` (local).
- Planned: Supabase migration post-demo. Schema in `src/tours/db.ts` is
  Postgres-compatible except for the `AUTOINCREMENT` detail on
  `sku_observations.id` which becomes `GENERATED ALWAYS AS IDENTITY`.

## Extending the Tool

### Adding a new platform (e.g. Viator, Expedia, Airbnb Experiences)

Each platform lives in `src/clis/<name>/` as a standalone opencli plugin with the same three commands: `search`, `detail`, `trending`. The build compiles to `dist/clis/<name>/` which is symlinked into `~/.opencli/plugins/<name>/`.

Steps to add a new platform — you can do these yourself without asking the user to touch anything:

1. **Copy an existing adapter as template.** Klook is a public-API adapter (`Strategy.PUBLIC`, no browser). Trip/GYG/KKday are Browser Bridge adapters that scrape DOM (`Strategy.BROWSER_BRIDGE`). Pick whichever matches the new site:
   ```bash
   cp -r src/clis/klook src/clis/viator        # if target has a public API
   cp -r src/clis/kkday src/clis/viator        # if you need to scrape DOM
   ```

2. **Rewrite `search.ts` and `detail.ts`** — the shape they must return is defined in `src/shared/types.ts` and `src/shared/parsers.ts`. Minimum for search: `{ id, title, price, rating, review_count, url }`. Minimum for detail: `{ packages, itinerary, sections }`. Keep the `cli({ site, name, ... })` registration block — just change `site` and `domain`.

3. **Build and register.**
   ```bash
   npm run build
   ln -sf "$PWD/dist/clis/viator" ~/.opencli/plugins/viator
   echo '{"name":"viator","version":"0.1.0","opencli":">=1.0.0"}' > dist/clis/viator/opencli-plugin.json
   opencli viator search "test" --limit 3     # smoke test
   ```

4. **Enable for AI comparison (no code change needed).** `src/compare/compare.ts` iterates whatever platforms the POI has configured — it doesn't have a hardcoded list. Just include the new platform when creating the POI:
   ```bash
   node dist/cli.js poi add "Mt Fuji" --keywords "Mt Fuji tour" --platforms klook,trip,viator
   ```

5. **(Optional) Web dashboard** — no work needed for the new platform to show up. The dashboard reads from the same POI config.

### Modifying an existing platform

Just edit `src/clis/<platform>/*.ts` and `npm run build`. Symlinks mean no re-registration. Verify with `opencli <platform> detail <id> -f json`.

### When the user asks Claude Code to extend

If the user asks "add platform X" or "the Klook detail is missing Y", you have everything you need:

- Source code of 4 working adapters to copy from
- `opencli doctor` to verify Browser Bridge is live
- `opencli <platform> search "..."` to test your changes
- `curl` and browser dev tools (via Browser Bridge) to reverse-engineer target sites

Iterate in the terminal: write adapter → build → run → read JSON output → fix → repeat. Expect the first draft of a new adapter to take 3–5 iterations against the real site.
