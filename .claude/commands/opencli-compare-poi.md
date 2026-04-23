---
description: Cross-platform POI price comparison (Klook / Trip / GYG / KKday)
argument-hint: <POI-name> [--date YYYY-MM-DD]
---

Invoke the `opencli-compare-poi` skill.

Argument interpretation:
- If `$ARGUMENTS` starts with a POI name → check if POI is configured (`list-pois`); if missing, offer to `add-poi` first.
- If `$ARGUMENTS` includes `--date`, pass it through to `compare-poi --date`.
- Always prompt before running with `--save` since it persists to the history DB.

Expect 1–3 minutes runtime (search × N platforms + LLM clustering). Strip `Update available` banner lines before parsing JSON output.

$ARGUMENTS
