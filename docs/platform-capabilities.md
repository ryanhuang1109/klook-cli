# Platform Capabilities & Command Reference

A single-source-of-truth for what the klook-cli toolchain can and cannot do across the four OTAs we monitor (Klook, Trip.com, GetYourGuide, KKday). Use this as the map before reaching for a specific command or skill.

- **Data pipeline**: scraper → canonical schema → SQLite → CSV / HTML / LLM analysis
- **Canonical schema**: Activity → Package → SKU (`(package × travel_date)`); daily observations append to `sku_observations`

---

## 1. Platform scraping matrix

|  | Klook | Trip.com | GetYourGuide | KKday |
|---|:-:|:-:|:-:|:-:|
| Strategy | **Public API** | Browser Bridge (Cookie) | Browser Bridge | Browser Bridge |
| Typical latency | <1 s | ~10 s | ~10 s | ~10 s |
| Identifier | Numeric activity ID (e.g. `151477`) | Numeric detail ID (e.g. `92795279`) | Trailing `t{N}` from URL (e.g. `12345` in `…-t12345`) | Numeric product ID (e.g. `2247`) |
| `search-activities` (alias: `search`) | ✅ | ✅ | ✅ | ✅ |
| `get-activity` (alias: `detail`) | ✅ | ✅ | ✅ | ✅ |
| `get-packages` (new, narrow projection) | ✅ | ✅ | ✅ | ✅ |
| `get-pricing-matrix` (alias: `pricing`, 7-day) | ✅ package × date | ✅ SKU × date | ✅ variant × date | ✅ package × date (min "from" price) |
| `list-trending` (alias: `trending`) | ✅ | ❌ | ❌ | ❌ |
| `probe` / `probe2` (debug) | ✅ | ✅ | ✅ (2 variants) | ✅ (2 variants) |
| Unique quirks | Public API has lower rate-limit risk | `--compare-dates` flag; `.m_ceil` dual-use (SKU vs date); title pollution | Language dropdown is a first-class variant axis; datepicker re-opens differently after first selection | Rich package tiers (Admission/Bundle/VIP); booking counter; "from" prices are minima only |

Fields we do **not** currently scrape: 划線價 (strikethrough price), 優惠金額 (discount amount), 促銷標籤 (promo labels). Adding these requires extending `src/clis/<p>/search.ts` + `detail.ts` + `shared/parsers.ts`.

---

## 2. Per-platform CLI commands

> **New API-style canonical names**. Old terse names (`search`, `detail`, `pricing`, `trending`) still work as aliases — scheduled routines and scripts are unaffected.

### Klook — `opencli klook <cmd>`

```bash
opencli klook search-activities "<query>" --limit <N> -f json
opencli klook get-activity <id> -f json           # full payload
opencli klook get-packages <id> -f json           # only packages[] (lighter)
opencli klook get-pricing-matrix <id> --days 7 -f json
opencli klook list-trending "<city>" -f json
opencli klook probe <id>                          # DEBUG
```

### Trip.com — `opencli trip <cmd>`

```bash
opencli trip search-activities "<query>" --limit <N> -f json
opencli trip get-activity <id-or-url> -f json
opencli trip get-activity <id> --compare-dates -f json   # inline 7-day min prices
opencli trip get-packages <id> -f json
opencli trip get-pricing-matrix <id> --days 7 -f json
opencli trip probe <id>                           # DEBUG
```

### GetYourGuide — `opencli getyourguide <cmd>`

```bash
opencli getyourguide search-activities "<query>" --limit <N> -f json
opencli getyourguide get-activity <id-or-url> -f json
opencli getyourguide get-packages <id-or-url> -f json
opencli getyourguide get-pricing-matrix <id-or-url> --days 7 -f json
opencli getyourguide probe <url>                  # DEBUG
opencli getyourguide probe2 <url>                 # DEBUG after date pick
```

### KKday — `opencli kkday <cmd>`

```bash
opencli kkday search-activities "<query>" --limit <N> -f json
opencli kkday get-activity <id-or-url> -f json
opencli kkday get-packages <id-or-url> -f json
opencli kkday get-pricing-matrix <id> --days 7 -f json
opencli kkday probe <id>                          # DEBUG
opencli kkday probe2 <url>                        # DEBUG no-click calendar
```

---

## 3. Cross-platform workflows (`node dist/cli.js`)

### POI management

Canonical top-level commands (preferred):
```bash
node dist/cli.js list-pois
node dist/cli.js add-poi "<name>" --keywords "<kw1>,<kw2>" --platforms klook,trip,getyourguide,kkday
node dist/cli.js remove-poi "<name>"
```

Legacy subcommand group (still works):
```bash
node dist/cli.js poi add "<name>" --keywords "..."
node dist/cli.js poi list
node dist/cli.js poi remove "<name>"
```

### Comparison

```bash
node dist/cli.js compare-poi "<POI>" --date <YYYY-MM-DD> --save -f json        # alias: compare
node dist/cli.js compare-poi --all --date <YYYY-MM-DD> --save -f json
node dist/cli.js get-poi-price-history "<POI>" --days 7                        # alias: compare-history
```
Runtime: 1–3 minutes (search × N platforms + LLM clustering).

---

## 4. Tours pipeline (`node dist/cli.js tours <cmd>`)

Canonical daily workflow is orchestrated by the **`opencli-routine` skill** (delegates to `opencli-scan` / `opencli-pricing`). Raw commands:

| Canonical | Alias | Purpose |
|---|---|---|
| `ingest-pricing <p> <id>` | `ingest` | Single-activity pricing → tours.db |
| `ingest-from-detail <p> <id>` | `ingest-detail` | Fallback using `get-activity` when `get-pricing-matrix` breaks |
| `ingest-top-from-search <p> <kw>` | `ingest-search` | Search → rank by review count → ingest top N |
| `ingest-from-snapshot <p> <file>` | `ingest-snapshot` | Replay saved JSON snapshot |
| `ingest-from-planning-csv <csv>` | `ingest-from-golden` | Batch-ingest from planning CSV |
| `run-daily-routine` | `run` | End-to-end: iterate + export CSV + report |
| `export-csv` | `export` | tours.db → `data/exports/<today>.csv` |
| `generate-report` | `report` | HTML coverage/completeness report |
| `list-activities [--platform <p>] [--poi …]` | `list` | List activities in the DB |
| `set-sku-review-status <id> <status>` | `review-sku` | Mark SKU verified / flagged / rejected |
| `set-activity-review-status <id> <status>` | `review-activity` | Same for activity-level |
| `find-cross-platform-match <url> --to <p>` | `match-from-url` | URL-first cross-platform match (LLM) |

---

## 5. Data artifacts

| Path | What |
|---|---|
| `data/tours.db` | SQLite canonical DB (Activity / Package / SKU / observations) |
| `data/golden/pricing-tna-planning.csv` | Ground-truth list of (platform, activity_id) targets |
| `data/snapshots/<platform>-<id>-<timestamp>.json` | Raw `pricing` dumps for snapshot replay |
| `data/exports/<date>.csv` | Latest planning-sheet CSV |
| `data/reports/<date>.html` + `latest.html` | Daily completeness/coverage report |

Schema reference: `src/tours/db.ts` (Postgres-compatible except `AUTOINCREMENT`).

---

## 6. Claude Code Skills (`.claude/skills/`)

| Skill | Role | Owner |
|---|---|---|
| `opencli-router` | Dispatches any opencli request to the right specialist | shared |
| `opencli-klook` | Klook commands + quirks (reference template) | Ryan Huang |
| `opencli-trip` | Trip.com commands + quirks | TODO |
| `opencli-getyourguide` | GetYourGuide commands + quirks | TODO |
| `opencli-kkday` | KKday commands + quirks | TODO |
| `opencli-routine` | Orchestrator that delegates to opencli-scan / opencli-pricing per (POI, platform) target | shared |
| `opencli-compare-poi` | Cross-platform POI compare workflow | shared |

Find the owner of any platform skill: `grep "^- \*\*Owner\*\*:" .claude/skills/*/SKILL.md`.

New platform skill template: `docs/skill-template-platform.md`.

---

## 7. Related third-party skills (installed via `npx skills add jackwener/opencli`)

| Skill | Role | When it helps |
|---|---|---|
| `opencli-adapter-author` | Writing a new adapter from scratch | Adding Viator / Airbnb Experiences |
| `opencli-autofix` | Auto-detect + patch DOM drift | A platform's pricing scraper starts returning empty |
| `opencli-browser` | Browser Bridge operation guidance | Debugging cookies / warmup / navigation |
| `opencli-usage` | Generic opencli usage patterns | General "how do I use opencli X" |
| `smart-search` | Semantic search over opencli capabilities | Discovering which command fits a task |

---

## 8. Output conventions (apply to every command)

- Always pass `-f json` when parsing programmatically.
- Strip `Update available: vA → vB` lines before `JSON.parse`.
- Price strings include the currency symbol/code as scraped (`US$89`, `TWD 2,800`, `EUR 45`). Downstream **must** normalize before comparing across platforms.
- Browser Bridge commands are ~10 s each; batch them, don't loop at concurrency 1 if you have 50+ targets.
- Every real `tours ingest` writes a snapshot — replay via `ingest-snapshot` instead of re-scraping.

---

## 9. Known gaps (wishlist)

1. **Enrichment fields**: strikethrough price, discount amount, promo labels — not scraped today.
2. **Automated validation harness**: we have `tours report` completeness flags but no per-metric `validate.js`-style unit checks.
3. **Cron wiring for `opencli-routine`**: skill is ready; scheduled routine prompt not yet configured.
4. **Airbnb / Viator adapters**: not implemented.
5. **API-style command names**: current names (`detail`, `pricing`) are terse — see `docs/api-renaming-proposal.md` if/when we migrate.
