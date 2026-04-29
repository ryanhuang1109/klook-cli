---
name: opencli-routine
description: Daily tours pipeline orchestrator. Decides which sub-skill to run for each (POI, platform) target — scan vs pricing vs both — and delegates. Does NOT implement scan or pricing inline; uses opencli-scan and opencli-pricing for that. Use when running the scheduled daily routine, when the user asks "run tours routine" / "daily refresh" / "scheduled run", or when the user wants the full tours flow without naming a specific mode. Owner: Ryan Huang.
---

# opencli-routine

Orchestrator for the daily tours pipeline. Decides which sub-skill to run for each (POI, platform) target — does NOT implement the work itself.

## Pre-flight

- Confirm `data/tours.db` exists and is readable.
- Confirm Browser Bridge cookie is `en-US` (per memory `feedback_browser_bridge_en_us`). Run `node dist/cli.js tours preflight-locale` if uncertain.

## Decide per (POI, platform) target

| Situation | Run |
|---|---|
| First time on this POI/platform | opencli-scan → `tours pin --top 5` → opencli-pricing |
| Daily price refresh of pinned items | opencli-pricing |
| Weekly coverage scan | opencli-scan |

## Cron / scheduled trigger

The default scheduled trigger runs `opencli-pricing` for every (POI, platform) in `list-pois`. Coverage scans are weekly via a separate trigger.

## What this skill does NOT do

- Does not run scan or pricing inline — always delegates to the matching skill.
- Does not duplicate platform quirks — those live in `opencli-<platform>`.
- Does not own DB schema — that's `src/tours/db.ts`.

## Companion skills

- **opencli-scan** — discovery half (search → detail).
- **opencli-pricing** — price-refresh half (pinned activities only).
- **opencli-<platform>** — per-platform troubleshooting (klook / trip / getyourguide / kkday / airbnb).
- **opencli-router** — entry-point dispatcher when the user hasn't named a platform.

**Owner:** Ryan Huang
