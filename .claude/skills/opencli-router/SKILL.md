---
name: opencli-router
description: Dispatches any request involving the klook-cli opencli toolchain to the right specialist skill. Use whenever the user mentions Klook / 客路, Trip.com / 攜程, GetYourGuide / GYG, KKday, Airbnb / Airbnb Experiences, cross-platform travel-activity pricing, POI monitoring, tours ingest/export/report, 比價 / 抓價 / 行程比較, activity-ID lookups, or any opencli command. Also use when the user names a specific activity URL or numeric ID on any of these five OTAs.
---

# opencli-router

This skill is a **dispatcher**. It does not implement platform logic itself — it points Claude at the specialist skill that owns that knowledge.

## When this skill fires, do two things:

1. Identify the platform(s) and task type involved.
2. Invoke the matching skill(s) listed below **before** running any `opencli` command.

## Platform dispatch table

| User mentions | Invoke skill | Source dir |
|---|---|---|
| Klook / 客路 / klook.com | `opencli-klook` | `src/clis/klook/` |
| Trip.com / 攜程 / trip.com | `opencli-trip` | `src/clis/trip/` |
| GetYourGuide / GYG / getyourguide.com | `opencli-getyourguide` | `src/clis/getyourguide/` |
| KKday / kkday.com | `opencli-kkday` | `src/clis/kkday/` |
| Airbnb Experiences / airbnb.com (`/experiences/{id}`) | `opencli-airbnb` | `src/clis/airbnb/` |

If the user names more than one platform (e.g. "compare Klook vs Trip"), invoke **all** matching platform skills plus the cross-platform task skill below.

## Task dispatch table

| User intent | Invoke skill |
|---|---|
| Run the daily/scheduled tours update, `tours ingest` / `export` / `report` | `opencli-tours-routine` |
| Compare a POI across platforms, `poi add` / `compare` / `compare-history` | `opencli-compare-poi` |
| Single-platform pricing snapshot | The matching platform skill above |

## Global conventions (apply to every platform)

- Always use `-f json` when you need to parse output programmatically.
- Strip any `Update available` banner lines before passing stdout to `JSON.parse`.
- Klook uses a public API (<1s); Trip / GYG / KKday use Browser Bridge (~10s each). Warm the Browser Bridge with `opencli doctor` if a scraper fails immediately.
- Source of truth for command shape: `node dist/cli.js --help` and `opencli <platform> --help`.

## Escalation

If the dispatched platform skill is missing, empty (only TODO markers), or contradicts observed CLI behavior, report to the user rather than guessing. The owner listed in that skill's body is responsible for keeping it current.

## What this skill is NOT

- It does not contain platform-specific ID formats, selectors, or quirks — those live in each platform skill.
- It does not drive the tours pipeline end-to-end — `opencli-tours-routine` does.
