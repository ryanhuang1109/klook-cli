---
description: Run an opencli trip task — scoped to Trip.com only (for skill owners testing their platform)
argument-hint: [activity-id | search-keyword]
---

Invoke the `opencli-trip` skill and operate **only on Trip.com** for this turn. Do not cross into other platforms.

Pre-flight: `opencli doctor` — Trip requires Browser Bridge. If it fails, stop and surface to user.

Argument interpretation:
- If `$ARGUMENTS` is numeric (e.g. `92795279`) → treat as Trip activity ID. Ask which sub-command:
  - `opencli trip get-activity <id>` — full payload (with optional `--compare-dates`)
  - `opencli trip get-packages <id>` — just packages[]
  - `opencli trip get-pricing-matrix <id> --days 7` — SKU × date matrix
- If `$ARGUMENTS` is a keyword phrase → `opencli trip search-activities "$ARGUMENTS" --limit 5 -f json`.
- If empty → load skill, print cheat-sheet, wait.

Note: Trip has no `trending` command. After executing, cross-check output against `docs/io-schemas.md` — Trip-specific: `--compare-dates` emits extra 7-day inline prices; SKU tabs vs date cells share `.m_ceil` class.

$ARGUMENTS
