---
name: opencli-compare-poi
description: Run cross-platform POI comparison using the opencli compare pipeline — list/add POIs, run compare across Klook/Trip/GYG/KKday with LLM clustering, save baselines, and review price history. Use when the user asks to compare prices across platforms, find the cheapest option for a POI, monitor a landmark's pricing over time, run poi list / poi add / compare / compare-history, or says "跨平台比價 / 比較各平台價格 / track 這個景點".
---

# opencli-compare-poi

This skill drives the cross-platform compare workflow. For platform-specific failures during the run, defer to the matching `opencli-<platform>` skill.

## Workflow

### 1. Check existing POIs
```bash
node dist/cli.js list-pois
```
If the target POI is already configured, skip to step 3.

### 2. Add POI (only if missing)
```bash
node dist/cli.js add-poi "<name>" \
  --keywords "<kw1>,<kw2>" \
  --platforms klook,trip,getyourguide,kkday
```
- Keywords should be the phrases a real searcher would type — not a single canonical name.
- Only include platforms the user actually wants compared; adding all four is the default but costs 4× Browser Bridge time.

### 3. Run compare
```bash
node dist/cli.js compare-poi "<POI name>" --date <YYYY-MM-DD> --save -f json
```
- `--save` persists the run so `compare-history` works later.
- Expect **1–3 minutes**: search × N platforms + LLM clustering.
- Strip `Update available` banner lines before parsing the JSON.

Batch mode for all configured POIs:
```bash
node dist/cli.js compare-poi --all --date <YYYY-MM-DD> --save -f json
```

### 4. Read results
The JSON shape groups activities into cross-platform clusters. For each cluster, surface to the user:
- Cheapest platform + price + link
- Price spread (max − min) as an absolute and a percentage
- Rating / review-count for each candidate so price isn't the only axis

### 5. (Optional) Track over time
```bash
node dist/cli.js get-poi-price-history "<POI name>" --days 7
```
Use when the user wants to see price drift since the last `--save`d baseline.

## Related: single-URL lookup

When the user has **one platform's URL** and wants to find the matching product on other platforms (not a fuzzy POI search), use `match-from-url` instead of the full compare:
```bash
node dist/cli.js tours find-cross-platform-match "https://www.klook.com/en-US/activity/<id>" --to trip -f json
```
This is URL-first, LLM-ranked, and typically faster than a full compare.

## Failure handling

- If one platform returns zero results, the compare still completes with the others — do not block the whole run. Note the empty platform in the summary.
- If the LLM clustering step fails, the raw per-platform hits are still written; surface the failure and offer to re-run clustering only.
- For a specific platform failure, consult `opencli-<platform>` skill for platform-level retries before treating it as a compare-level issue.

## What this skill is NOT

- It does not ingest into the tours DB — that is `opencli-routine`.
- It does not bulk-run without `--save` by default; always ask the user if they want the run persisted.
