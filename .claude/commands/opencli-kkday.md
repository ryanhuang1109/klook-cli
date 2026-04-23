---
description: Run an opencli kkday task — scoped to KKday only (for skill owners testing their platform)
argument-hint: [product-id | search-keyword]
---

Invoke the `opencli-kkday` skill and operate **only on KKday** for this turn.

Pre-flight: `opencli doctor` — KKday requires Browser Bridge. KKday's first request after cold bridge may return skeletal page; retry-once is typical.

Argument interpretation:
- If `$ARGUMENTS` is numeric (e.g. `2247`) → treat as KKday product ID. Ask which sub-command:
  - `opencli kkday get-activity <id>` — full payload (includes `order_count` booking counter, unique to KKday)
  - `opencli kkday get-packages <id>` — just packages[]
  - `opencli kkday get-pricing-matrix <id> --days 7` — package × date matrix ("from" price minima)
- If `$ARGUMENTS` is a keyword phrase → `opencli kkday search-activities "$ARGUMENTS" --limit 5 -f json`.
- If empty → load skill, print cheat-sheet, wait.

Note: No `trending` command. KKday `get-pricing-matrix` gives **minimum across sub-SKUs** per package/date, not per-SKU prices.

$ARGUMENTS
