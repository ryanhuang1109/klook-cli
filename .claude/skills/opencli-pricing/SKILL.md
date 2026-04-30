---
name: opencli-pricing
description: >
  Refresh prices for pinned activities of a (POI, platform) pair. High-frequency, intended
  for daily runs. Handles the no_pinned decision panel when no activities are pinned yet —
  never silently falls back to scan. Does NOT call scan or detail paths.
  Trigger when: user invokes a platform pricing subcommand; the daily routine fires a price
  refresh; user says "refresh price", "update prices", "刷價", or similar price-update intent
  for a specific POI and platform. Owner: Ryan Huang.
---

# opencli-pricing

Refresh SKU prices for pinned activities on one (POI, platform) pair. Precondition: activities
must already be pinned via `tours pin`. If nothing is pinned, present the decision panel below —
never auto-fallback to scan.

## Scope

**In scope:** call `tours pricing`, append sku_observations, report anomalies.
**Out of scope:** detail/scan paths, implementing `pin`, silently falling back when nothing is pinned.

## Pre-flight

Identical to `opencli-scan`:
1. `opencli doctor` for Browser Bridge platforms (trip, getyourguide, kkday, airbnb).
2. Confirm en-US locale before running.

## Run

```bash
node dist/cli.js tours pricing --platform <platform> --poi "<POI>"
```

Example:
```bash
node dist/cli.js tours pricing --platform klook --poi "Mount Fuji"
```

## no_pinned decision panel

If the command exits with code 2 or outputs `no_pinned: true`, **stop and present this numbered
list to the user**. Do NOT auto-select any option.

```
No pinned activities found for <POI> on <platform>.

What would you like to do?
  1) Run all mode — scan + price everything discovered
  2) Run scan first, then pin manually before pricing
  3) Pin top 5 from a previous scan and price those
     (requires scan to have already run)
  4) Cancel
```

Wait for the user's choice, then:
- **1** → invoke the platform "all" subcommand
- **2** → invoke `opencli-scan` for this (POI, platform), then stop and ask user to pin
- **3** → run `node dist/cli.js tours pin --platform <platform> --poi "<POI>" --top 5`, then re-run pricing
- **4** → stop

## Per-activity failure

If pricing logs an error for a specific activity ID, delegate to the matching
`opencli-<platform>` skill's failure fallback (snapshot + manual ingest).

## Anomaly detection

After a successful run, check for price jumps:
- Flag any SKU where the latest observation differs from the previous by more than 30%.
- Report flagged SKUs to the user with old price, new price, and % change.
- Suggest `node dist/cli.js tours set-sku-review-status <sku-id> flagged --note "price jump"`.

## Report

At the end of every pricing run, report:
- SKUs refreshed (observations appended)
- Anomalies flagged (>30% price jump)
- Any per-activity failures with activity IDs

## Companion skills

| Skill | When to use |
|---|---|
| `opencli-scan` | Precondition for first-time POIs; option 2 in no_pinned panel |
| `opencli-<platform>` | Per-activity failures; platform-specific quirks |
| `opencli-routine` | Orchestrator that dispatches this skill on daily schedule |
