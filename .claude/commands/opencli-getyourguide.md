---
description: Run an opencli getyourguide task — scoped to GetYourGuide only (for skill owners testing their platform)
argument-hint: [activity-id | full-url | search-keyword]
---

Invoke the `opencli-getyourguide` skill and operate **only on GetYourGuide** for this turn.

Pre-flight: `opencli doctor` — GYG requires Browser Bridge.

Argument interpretation:
- If `$ARGUMENTS` matches `t\d+` or is a full `getyourguide.com` URL → treat as GYG activity ID. Ask which sub-command:
  - `opencli getyourguide get-activity <id-or-url>` — full payload including language options
  - `opencli getyourguide get-packages <id-or-url>` — just packages[]
  - `opencli getyourguide get-pricing-matrix <id-or-url> --days 7`
- If `$ARGUMENTS` is a keyword phrase → `opencli getyourguide search-activities "$ARGUMENTS" --limit 5 -f json`.
- If empty → load skill, print cheat-sheet, wait.

Note: No `trending` command. GYG treats language as a first-class variant axis — expect more `packages[]` entries than a naïve matrix.

$ARGUMENTS
