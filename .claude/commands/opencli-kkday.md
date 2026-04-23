---
description: Run an opencli kkday task — scoped to KKday only (for skill owners testing their platform)
argument-hint: [product-id | "keyword" | --poi <name>] [--csv | --ingest]
---

Invoke the `opencli-kkday` skill and operate **only on KKday** for this turn.

Pre-flight: `opencli doctor` — KKday requires Browser Bridge. KKday's first request after cold bridge may return skeletal page; retry-once is typical.

**Argument interpretation**:

1. **`--poi <name>`** → `list-pois` → use POI keywords to search.
2. **Numeric ID** (e.g. `2247`) → single-product mode. Ask which: `get-activity` / `get-packages` / `get-pricing-matrix`.
3. **Quoted keyword phrase** → `opencli kkday search-activities "<phrase>" --limit 5 -f json`.
4. **Empty** → cheat-sheet.

**Output-format flags**:
- `--csv` → `-f csv` on final call
- `--ingest` → `tours ingest-pricing kkday <id>` + `tours export-csv`
- Default → JSON

KKday `get-pricing-matrix` gives **minimum across sub-SKUs** per package/date, not per-SKU prices. No `trending`.

$ARGUMENTS
