---
name: opencli-tours-routine
description: End-to-end playbook for the daily tours pipeline — ingest fresh pricing across platforms, export to CSV, generate the HTML report, check completeness, flag anomalies, and honor prior human feedback. Use when the user asks to run the tours routine, refresh the tours DB, produce the daily report, update pricing for tracked activities, run the scheduled routine manually, or says "tours ingest/export/report". Also use when a scheduled routine fires and needs the canonical daily workflow.
---

# opencli-tours-routine

This skill drives the full daily pipeline. It calls into `opencli-<platform>` skills for platform-specific failures — **do not** duplicate platform logic here.

## Pre-flight

- Confirm `data/tours.db` exists. If missing, abort and ask the user to seed it.
- Confirm `data/golden/pricing-tna-planning.csv` is present — it is the source of (platform, activity_id) targets.
- `node dist/cli.js tours list-activities --limit 5` to sanity-check the DB is readable.

## Step 1 — Read prior feedback (skip rejected, honor flagged notes)

Before re-scraping, query review statuses:
```bash
sqlite3 data/tours.db "SELECT id, platform, product_id, review_status, review_note FROM activities WHERE review_status IN ('rejected','flagged');"
```
- `review_status = 'rejected'` → skip this activity entirely on this run.
- `review_status = 'flagged'` with an actionable note (e.g. "use en-UK locale") → apply the hint when re-ingesting.

## Step 2 — Fetch fresh pricing

Preferred bulk path:
```bash
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv --platforms klook,trip,getyourguide,kkday --days 7
```

Per-activity path (when you need granular control):
```bash
node dist/cli.js tours ingest-pricing <platform> <activity-id> --poi "<POI>" --days 7
```

On failure for a specific target, do **not** retry blindly. Invoke the matching `opencli-<platform>` skill and follow its fallback playbook (typically: retry once → `tours ingest-detail` → snapshot replay → `browse` manual capture).

## Step 3 — Export and report

```bash
node dist/cli.js tours export-csv                 # writes data/exports/<today>.csv
node dist/cli.js tours generate-report                 # writes data/reports/<today>.html + latest.html
```

## Step 4 — Check completeness

Open the JSON summary emitted alongside the report (path printed by `tours report`). Look at `completeness_flags`:
- `missing_supplier` unusually high → a scraper regressed; open the affected platform skill and re-ingest.
- `missing_departure_time` → usually a detail-level field; re-run `tours ingest-detail` for affected rows.
- `unknown_tour_type` → the normalizer (`src/tours/normalize.ts`) needs tuning; surface to the user, do not silently re-classify.

## Step 5 — Flag anomalies

For each SKU whose latest observation moved **>30%** vs the previous observation:
```bash
node dist/cli.js tours set-sku-review-status <sku-id> flagged --note "price jump <old> → <new>"
```
Do not auto-verify large moves — always flag for human review.

## Step 6 — Summarize the run

Report back to the user:
- Targets attempted / succeeded / failed per platform.
- Paths of `data/exports/<today>.csv` and `data/reports/latest.html`.
- List of SKUs auto-flagged in Step 5.
- Any activity skipped due to `review_status = 'rejected'`.

## Escalation

- Persistent Browser Bridge failure across multiple platforms → `opencli doctor`, then surface to the user (likely environment issue, not code).
- Golden CSV and DB disagree on which activities to track → ask the user which is source of truth before modifying either.

## What this skill is NOT

- It does not define the canonical schema — that lives in `src/tours/db.ts`.
- It does not teach platform quirks — those live in `opencli-<platform>` skills.
- It does not auto-run on a schedule — the user triggers it manually; scheduled routine wiring is a separate decision.

## DB writes

The tours routine writes to **seven tables** — see `docs/io-schemas.md` for the full column-level schema.

| Phase | Tables written |
|---|---|
| Step 2 (ingest-pricing / ingest-from-detail) | `activities` (upsert) → `packages` (upsert) → `skus` (upsert) → `sku_observations` (append) |
| Step 2 failures | `execution_logs` (append) — one row per attempt with strategy / duration / error |
| Step 2 via `ingest-top-from-search` | `search_runs` (append) with per-platform hit count |
| `run-daily-routine` | `run_sessions` (one row wrapping the whole run, with status `running` → `finished`) |
| Step 5 (set-sku-review-status / set-activity-review-status) | `skus.review_status` / `activities.review_status` UPDATE |
| Step 4 (completeness flags) | stored per-package in `packages.completeness_json` (JSON blob) |

**Supabase migration checklist** (when wiring):
- Map `AUTOINCREMENT` PKs → `GENERATED ALWAYS AS IDENTITY`
- Map JSON-as-TEXT columns (`raw_extras_json`, `inclusions`, `exclusions`, `completeness_json`, `available_languages`) → `JSONB`
- Map ISO-timestamp TEXT columns → `TIMESTAMPTZ`
- RLS: `service_role` full, `authenticated` read-only on activities/packages/skus

The normalizer (`src/tours/normalize.ts`) owns all numeric parsing (K/M suffixes, currency extraction, date normalization) — **the routine should never inline these**. If a scraper returns data the normalizer rejects, treat it as a completeness flag, not a silent fix.
