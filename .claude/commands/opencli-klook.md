---
description: Run an opencli klook task — scoped to Klook only (for skill owners testing their platform)
argument-hint: [activity-id | search-keyword]
---

Invoke the `opencli-klook` skill and operate **only on Klook** for this turn. Do not cross into other platforms even if the conversation context mentions them.

Argument interpretation:
- If `$ARGUMENTS` is numeric (e.g. `93901`) → treat as Klook activity ID. Ask the user which sub-command they want:
  - `opencli klook get-activity <id>` — full activity payload
  - `opencli klook get-packages <id>` — just packages[] (lighter)
  - `opencli klook get-pricing-matrix <id> --days 7` — package × date matrix
- If `$ARGUMENTS` looks like a keyword phrase → run `opencli klook search-activities "$ARGUMENTS" --limit 5 -f json` and present the top hits with IDs.
- If `$ARGUMENTS` is empty → load the skill, print the command cheat-sheet, and wait for instruction.

After executing, verify output against the I/O schema in `docs/io-schemas.md` section 3 (Klook-specific: has `supplier` field, `trending` command available).

$ARGUMENTS
