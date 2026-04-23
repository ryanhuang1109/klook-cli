---
description: Run an opencli getyourguide task — scoped to GetYourGuide only (for skill owners testing their platform)
argument-hint: [activity-id | full-url | "keyword" | --poi <name>] [--csv | --ingest]
---

Invoke the `opencli-getyourguide` skill and operate **only on GetYourGuide** for this turn.

Pre-flight: `opencli doctor` — GYG requires Browser Bridge.

**Argument interpretation**:

1. **`--poi <name>`** → `list-pois` → use POI keywords to search.
2. **`t\d+` pattern or `getyourguide.com` URL** → single-activity mode. Ask which: `get-activity` / `get-packages` / `get-pricing-matrix`.
3. **Quoted keyword phrase** → `opencli getyourguide search-activities "<phrase>" --limit 5 -f json`.
4. **Empty** → cheat-sheet.

**Output-format flags**:
- `--csv` → `-f csv` on final call
- `--ingest` → `tours ingest-pricing getyourguide <id>` + `tours export-csv`
- Default → JSON

GYG treats language as a first-class variant axis — expect more `packages[]` entries than a naïve matrix. No `trending` command.

$ARGUMENTS
