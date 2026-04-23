---
description: Run an opencli klook task — scoped to Klook only (for skill owners testing their platform)
argument-hint: [activity-id | "keyword" | --poi <name>] [--csv | --ingest]
---

Invoke the `opencli-klook` skill and operate **only on Klook** for this turn. Do not cross into other platforms.

**Argument interpretation** (parse `$ARGUMENTS` in this order):

1. **`--poi <name>`** → POI mode:
   - `node dist/cli.js list-pois` — check if the POI is configured
   - If configured, use its `keywords` to search; if missing, offer to `add-poi` first

2. **Numeric ID** (e.g. `93901`) → single-activity mode:
   - Ask which sub-command: `get-activity` / `get-packages` / `get-pricing-matrix`
   - Default to `get-activity`

3. **Quoted keyword phrase** (e.g. `"Mt Fuji day tour"`) → search mode:
   - `opencli klook search-activities "<phrase>" --limit 5 -f json`

4. **Empty** → print command cheat-sheet from the skill body

**Output-format flags**:
- `--csv` → append `-f csv` to the final opencli call
- `--ingest` → after scraping, pipe through `tours ingest-pricing klook <id>` + `tours export-csv` for a clean planning-sheet CSV
- **Default** → pretty-printed JSON

Verify output against `docs/io-schemas.md` section 3. Klook-specific: has `supplier` field, has `list-trending` command (not supported on other platforms).

$ARGUMENTS
