---
description: Run an opencli trip task — scoped to Trip.com only (for skill owners testing their platform)
argument-hint: [activity-id | "keyword" | --poi <name>] [--csv | --ingest]
---

Invoke the `opencli-trip` skill and operate **only on Trip.com** for this turn. Do not cross into other platforms.

Pre-flight: `opencli doctor` — Trip requires Browser Bridge. If it fails, stop and surface to user.

**Argument interpretation** (parse `$ARGUMENTS` in this order):

1. **`--poi <name>`** → POI mode:
   - `node dist/cli.js list-pois` — check if the POI is configured
   - If configured, use its `keywords` to search; if missing, offer to `add-poi` first
   - Confirm before running multi-step ingestion

2. **Numeric ID** (e.g. `92795279`) → single-activity mode:
   - Ask which sub-command: `get-activity` (full) / `get-packages` (lighter) / `get-pricing-matrix` (7-day matrix)
   - Default to `get-activity` if user doesn't specify

3. **Quoted keyword phrase** (e.g. `"Mt Fuji day tour"`) → search mode:
   - `opencli trip search-activities "<phrase>" --limit 5 -f json`
   - Strip `Update available` banner lines before JSON.parse

4. **Empty** → print command cheat-sheet from the skill body, wait for instruction

**Output-format flags** (apply on top of any mode above):
- `--csv` → append `-f csv` to the final opencli call (warning: nested payloads may flatten awkwardly)
- `--ingest` → after scraping, pipe through `tours ingest-pricing trip <id>` to persist + then run `tours export-csv` to emit a clean planning-sheet CSV
- **Default** → pretty-printed JSON

Note: Trip has no `trending` command. After executing, cross-check output against `docs/io-schemas.md` — Trip-specific: `--compare-dates` emits extra 7-day inline prices; SKU tabs vs date cells share `.m_ceil` class.

$ARGUMENTS
