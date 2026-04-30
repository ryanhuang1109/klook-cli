---
name: opencli-scan
description: >
  Discover and enrich activities for a (POI, platform) pair via search to detail ingestion.
  Drives coverage toward 90%. Does NOT write pricing data — use opencli-pricing for that.
  Trigger when: user invokes a platform scan or detail subcommand; the opencli-routine
  orchestrator decides a (POI, platform) needs coverage work; user says "discover", "scan",
  "find more activities", "expand coverage", or similar discovery intent for a specific POI
  and platform. Owner: Ryan Huang.
---

# opencli-scan

Discover + enrich activities for one (POI, platform) pair. Companion to `opencli-pricing`
(next step once activities are pinned) and `opencli-routine` (orchestrator).

## Scope

**In scope:** search activities, enrich with detail, report coverage delta.
**Out of scope:** SKU writes, `tours pricing`, platform quirks (those live in `opencli-<platform>`).

## Pre-flight

1. Run `opencli doctor` for any Browser Bridge platform (trip, getyourguide, kkday, airbnb).
2. Confirm locale is **en-US** — adapters are written against en-US DOM; zh-TW breaks them silently.
   Check: `opencli <platform> search-activities "test" --limit 1 -f json` and inspect `url` field.

## Run

```bash
node dist/cli.js tours scan --platform <platform> --poi "<POI>"
```

Example:
```bash
node dist/cli.js tours scan --platform klook --poi "Mount Fuji"
```

## Per-activity failure

If the scan command logs an error for a specific activity ID, delegate to the matching
`opencli-<platform>` skill's fallback playbook (snapshot + manual ingest if needed).

## Post-run

After a successful scan, optionally suggest:

```bash
node dist/cli.js tours pin --platform <platform> --poi "<POI>" --top 5
```

Only suggest this if the user wants to start tracking prices. Explain that pinning selects
the top N activities for daily price refresh via `opencli-pricing`.

## Report

At the end of every scan, report:
- Count of activities discovered
- Count newly enriched (had detail ingested for first time)
- Coverage % before → after (activities with full detail / total discovered)
- Any per-activity failures with activity IDs

## Companion skills

| Skill | When to use |
|---|---|
| `opencli-pricing` | After scan + pin, to start daily price refresh |
| `opencli-<platform>` | Per-activity failures; platform-specific quirks |
| `opencli-routine` | Orchestrator that dispatches this skill automatically |
