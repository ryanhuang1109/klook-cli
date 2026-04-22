# klook-cli

Cross-platform activity & pricing intelligence for Klook, Trip.com,
GetYourGuide, and KKday — canonical three-tier schema
(Activity → Package → SKU), LLM agent-browser fallback when scrapers
hit a wall, and a tabbed BD-ready HTML + CSV report that auto-deploys
to Vercel.

Live demo:
- Latest report: https://competitor-supply-intelligence.vercel.app/report
- CSV: https://competitor-supply-intelligence.vercel.app/csv
- Pipeline status & trigger form: https://competitor-supply-intelligence.vercel.app/tours

---

## 1. What you get

- **Tours pipeline** — `tours run` takes a `destination + keyword` and
  crawls all configured OTAs. Output lands in SQLite + CSV + a tabbed
  HTML report with POI × Platform cross-tabs, hero images, and real
  page screenshots.
- **Canonical schema** — Activity (1 per URL) → Package (variant) →
  SKU (package × travel date). Observations are append-only, so price
  history never overwrites.
- **LLM fallback** — when the DOM scraper returns 0 packages (redesign,
  ticket product, A/B test), an LLM agent loads the page and extracts
  packages itself. Logged as `agent-browser-fallback` in `execution_logs`.
- **Session + execution logs** — every run gets a session ID; every
  ingest attempt is logged with strategy, duration, error, packages,
  SKUs.
- **Config-driven POIs** — edit `data/routine-config.json` to add or
  remove POIs. No code changes.

---

## 2. Install (5 min)

Needs Node.js 20+, a working Chrome installation, macOS or Linux.

```bash
git clone https://github.com/ryanhuang1109/klook-cli.git
cd klook-cli
npm install
npm run build
```

Install opencli globally and load its Chrome extension (opencli borrows
your real browser session — no stored credentials):

```bash
npm install -g @jackwener/opencli
```

In Chrome: `chrome://extensions/` → Developer Mode → Load unpacked →
select `/tmp/opencli-extension/extension` (opencli prints the exact
path on first run).

Verify:

```bash
opencli doctor
```

Should print three `[OK]` lines (Daemon, Extension, Connectivity).
If not, stop here and debug — nothing downstream works without Browser
Bridge.

---

## 3. Configure your POIs

Edit `data/routine-config.json`. Each entry has a `destination`, a
search `keyword`, and a human-readable `poi` label:

```json
{
  "pois": [
    { "destination": "tokyo", "keyword": "mt fuji",         "poi": "Mount Fuji" },
    { "destination": "kyoto", "keyword": "kiyomizu temple", "poi": "Kiyomizu Temple" },
    { "destination": "seoul", "keyword": "dmz",             "poi": "DMZ" }
  ],
  "competitors": ["klook", "trip", "getyourguide", "kkday"],
  "limit_per_platform": 10,
  "screenshot": true,
  "sort": "reviews",
  "agent_mode_on_retry": "loop"
}
```

---

## 4. Run

One-off for every POI in the config:

```bash
bash scripts/daily-routine.sh
```

Or ad-hoc for a single destination:

```bash
node dist/cli.js tours run \
  --destination tokyo --keyword "mt fuji" \
  --competitors klook,trip,getyourguide,kkday \
  --limit 10 --screenshot
```

Output lands in:
- `data/exports/<YYYY-MM-DD>.csv` (and a stable `latest.csv`)
- `data/reports/<YYYY-MM-DD>.html` (and `latest.html`)
- `data/snapshots/<platform>-<id>-<timestamp>.json` (raw scraper payload)
- `data/screenshots/<platform>-<id>.png` (real page screenshot)

Form-based trigger (same machine only):

```bash
npm run web
# open http://localhost:17890/tours
```

---

## 5. Daily cron (optional)

macOS and Linux — one crontab line:

```bash
crontab -e
```

Append (use the absolute path to your clone):

```cron
3 10 * * * /absolute/path/to/klook-cli/scripts/daily-routine.sh
```

On macOS, give `/usr/sbin/cron` Full Disk Access under
System Settings → Privacy & Security. Without that, cron fires but
git push and file writes fail silently.

The script is portable: it resolves its own repo path and discovers
Node via `~/.nvm`, `/opt/homebrew`, `/usr/local`, or `/usr/bin` in
that order. If your clone has no push access, commits still land
locally — the push just skips.

Each run logs to `data/routine-logs/<YYYY-MM-DD>.log`.

---

## 6. OpenRouter API key — optional, AI analysis only

You do **not** need an OpenRouter key for normal scraping. Set one
only when you want:

- `agent-browser-fallback` to recover activities whose DOM the
  scrapers can't parse (ticket products, site redesigns, blocked pages).
- `tours match-from-url` — cross-platform matching driven by the LLM.

To set:

```bash
echo 'OPENROUTER_API_KEY="sk-or-..."' > .env.development.local
```

The loader also falls back to `~/.klook-cli/config.json` for
backwards compatibility with the legacy `install.sh` installer.

---

## 7. Inspect / debug

```bash
# List activities in the DB
node dist/cli.js tours list
node dist/cli.js tours list --platform klook --poi "Mount Fuji"

# Mark rows for BD review
node dist/cli.js tours review-sku <sku-id> flagged --note "price looks wrong"
node dist/cli.js tours review-activity <id> rejected --note "wrong POI"

# Re-ingest one activity with the multi-turn agent loop
node dist/cli.js tours ingest-detail klook <activity-id> \
  --poi "Mount Fuji" --url "<canonical-url>" --agent-mode loop --screenshot
```

Sessions and execution logs live in `data/tours.db` under the
`run_sessions` and `execution_logs` tables. They also surface in the
HTML report's **Runs** tab.

---

## 8. Repo layout

```
src/
  cli.ts                       # CLI entry; wires every command
  tours/                       # tours pipeline
    types.ts                   # canonical Activity/Package/SKU schema
    db.ts                      # SQLite (sql.js); DDL + queries
    ingest.ts                  # opencli detail → normalize → upsert
    agent-fallback.ts          # single-shot LLM extraction
    agent-loop.ts              # multi-turn agent (click dropdowns / pickers)
    normalize.ts               # platform-agnostic row normalization
    export.ts                  # CSV + HTML report rendering
    commands.ts                # command handlers called from cli.ts
    match.ts                   # match-from-url cross-platform matcher
    llm.ts                     # OpenRouter adapter
    env.ts                     # env loader (.env*, ~/.klook-cli/config.json)
  clis/                        # per-platform opencli adapters
    klook/   trip/   getyourguide/   kkday/
  web/
    public/                    # landing page + tours trigger UI
    server.ts                  # local Express server (npm run web)
    tours-api.ts               # /api/tours/* endpoints
scripts/
  daily-routine.sh             # portable cron script
  build-routine-state.mjs      # dumps state → routine-state.json (Vercel)
data/
  routine-config.json          # POI configuration (edit + push → next run)
  tours.db                     # SQLite
  reports/   exports/   screenshots/   snapshots/   routine-logs/
```

---

## 9. Collaborating

Each clone has its own SQLite DB — two colleagues running the pipeline
in parallel won't share state. If that becomes important (central
dashboard, cross-team review), the canonical schema is
Postgres-compatible and ready to migrate to Supabase.

git push in the daily script only works when your clone has a writable
remote. For a colleague who clones the public repo without push access:

- Commits land locally; push is skipped gracefully.
- Reports can still be viewed locally (`data/reports/latest.html`) or
  via `npm run web` at `http://localhost:17890/tours`.
- To publish to your own Vercel URL, fork the repo and re-link Vercel.

---

## 10. Use with Claude Code (optional)

The repo ships with a `CLAUDE.md` that Claude Code reads automatically.
After installing, you can open the project and use natural language
instead of CLI flags:

```
Run today's tours refresh for Mount Fuji, Kiyomizu Temple, and DMZ.
Flag any activity whose price moved more than 30% since yesterday.
```

```
Find me similar tours on GetYourGuide matching this Klook URL:
https://www.klook.com/en-US/activity/151477
```

Natural-language prompts route to the same CLI commands described above.
