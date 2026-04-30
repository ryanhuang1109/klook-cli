#!/bin/bash
# Daily tours competitor refresh — invoked by system cron (or manually).
#
# Reads config from Supabase via `tours routine fetch-config` (with local
# fallback to data/routine-config.json). Web Schedule page edits Supabase;
# this script picks the change up on the next run automatically — no git
# pull needed.
#
# Usage:
#   bash scripts/daily-routine.sh              # default: pricing (daily refresh)
#   bash scripts/daily-routine.sh pricing      # explicit pricing-only
#   bash scripts/daily-routine.sh scan         # broad coverage refresh (scan + pin + pricing)
#   bash scripts/daily-routine.sh all          # alias for scan
#
# Mode rationale:
#   pricing — cheap daily refresh of pinned activities only. ~5 SKUs × N POI × M platform.
#   scan    — broad coverage scan + re-pin top-5 + price the pinned. Heavier; weekly is sensible.
#
# Cron suggestion:
#   0  9 * * *  /path/to/scripts/daily-routine.sh pricing       # daily 9am
#   0 10 * * 0  /path/to/scripts/daily-routine.sh scan          # weekly Sunday 10am
#
# Portable: locates the repo from the script's own path (no hardcoded
# user dir) and discovers Node via common install locations. macOS or
# Linux with Node 20+ via nvm / homebrew / system.

set -u

MODE="${1:-pricing}"
case "$MODE" in
  pricing|scan|all) ;;
  *)
    echo "Unknown mode: $MODE  (valid: pricing | scan | all)" >&2
    exit 2
    ;;
esac
[ "$MODE" = "all" ] && MODE="scan"

# Resolve the script's real location even when symlinked. REPO = repo root.
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_PATH" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  [[ "$SCRIPT_PATH" != /* ]] && SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
done
REPO="$(cd -P "$(dirname "$SCRIPT_PATH")/.." && pwd)"

CONFIG="$REPO/data/routine-config.json"
LOG_DIR="$REPO/data/routine-logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# cron runs with a minimal env. Probe the usual Node install locations. The
# nvm alias file (~/.nvm/alias/default) stores just a major version spec
# like "22", so we walk ~/.nvm/versions/node/ and take the first concrete
# install that has a node binary. Falls through to homebrew / system.
NVM_NODE_BIN=""
if [ -d "$HOME/.nvm/versions/node" ]; then
  for v in "$HOME/.nvm/versions/node/"*; do
    if [ -x "$v/bin/node" ]; then
      NVM_NODE_BIN="$v/bin"
      break
    fi
  done
fi
for candidate in \
    "$NVM_NODE_BIN" \
    /opt/homebrew/bin \
    /usr/local/bin \
    /usr/bin; do
  if [ -n "$candidate" ] && [ -x "$candidate/node" ]; then
    export PATH="$candidate:$PATH"
    break
  fi
done

cd "$REPO" || { echo "[$(date)] ERROR: cd $REPO failed" >>"$LOG_FILE"; exit 1; }

{
  echo "=========================================="
  echo "=== daily-tours-refresh @ $(date -Iseconds) ==="
  echo "=== mode: $MODE ==="
  echo "=========================================="
  echo "node: $(which node) ($(node --version))"
  echo "opencli: $(which opencli)"
  echo

  # ── Stamp host info so the Vercel landing page can show which
  # ── machine is actually running the cron.
  node -e '
    const fs = require("fs");
    const os = require("os");
    fs.writeFileSync("data/host-info.json", JSON.stringify({
      hostname: os.hostname(),
      platform: os.platform(),
      user: os.userInfo().username,
      last_run_at: new Date().toISOString(),
      node_version: process.version,
    }, null, 2));
  '

  # ── Fetch config from Supabase (web edits land here) ──────────
  # Falls back to existing local data/routine-config.json on any
  # Supabase failure so cron keeps running on bad-network days.
  echo "=== FETCH CONFIG ==="
  node dist/cli.js tours routine fetch-config --out "$CONFIG" || {
    echo "(fetch-config exited non-zero — relying on existing local file)"
  }
  echo

  # ── Pre-flight ────────────────────────────────────────────────
  echo "=== PRE-FLIGHT ==="
  if ! opencli doctor >/dev/null 2>&1; then
    echo "! opencli doctor failed — aborting"
    opencli doctor
    exit 2
  fi
  echo "opencli doctor: ok"

  [ -f .env.development.local ] || { echo "! .env.development.local missing"; exit 2; }
  echo "env: ok"

  [ -f "$CONFIG" ] || { echo "! $CONFIG missing"; exit 2; }
  echo "config: ok"
  echo

  # ── Read config once, derive shell-safe values ────────────────
  COMPETITORS=$(node -e 'console.log(require(process.argv[1]).competitors.join(","))' "$CONFIG")
  LIMIT=$(node -e 'console.log(require(process.argv[1]).limit_per_platform)' "$CONFIG")
  SORT_BY=$(node -e 'console.log(require(process.argv[1]).sort || "reviews")' "$CONFIG")
  TOP=$(node -e 'console.log(require(process.argv[1]).pin_top || 5)' "$CONFIG")
  SCREENSHOT_FLAG=$(node -e 'console.log(require(process.argv[1]).screenshot ? "--screenshot" : "")' "$CONFIG")

  echo "competitors: $COMPETITORS"
  echo "limit: $LIMIT  sort: $SORT_BY  pin-top: $TOP  screenshot: ${SCREENSHOT_FLAG:-off}"
  echo

  # ── Run each (POI × competitor) ───────────────────────────────
  # New flow (post #1): for each pair, pick scan vs pricing per MODE.
  #
  #   pricing mode (default daily):
  #     - tours pricing (refresh pinned only)
  #     - if exit 2 / no_pinned, bootstrap with scan + pin + pricing
  #       (cron has no user to ask — bootstrap is the only sane
  #       fallback; daily slash UX still does the "ask" thing)
  #
  #   scan mode (weekly broad refresh):
  #     - tours scan (search → detail, no SKU writes)
  #     - tours pin --top N (idempotent; never demotes)
  #     - tours pricing
  #
  IFS=',' read -ra COMP_ARR <<< "$COMPETITORS"
  node -e '
    const cfg = require(process.argv[1]);
    for (const p of cfg.pois) console.log([p.destination, p.keyword, p.poi].join("\t"));
  ' "$CONFIG" | while IFS=$'\t' read -r DEST KW POI; do
    echo "=========================================="
    echo "=== POI: $POI (dest=$DEST, kw=\"$KW\") ==="
    echo "=========================================="
    for COMP in "${COMP_ARR[@]}"; do
      echo "── $COMP ────────────────────────────────"
      if [ "$MODE" = "scan" ]; then
        node dist/cli.js tours scan --platform "$COMP" --poi "$POI" \
          --keyword "$KW" --limit "$LIMIT" --sort-by "$SORT_BY" $SCREENSHOT_FLAG \
          || echo "(scan failed for $COMP × $POI)"
        node dist/cli.js tours pin --platform "$COMP" --poi "$POI" --top "$TOP" \
          || echo "(pin failed for $COMP × $POI)"
        node dist/cli.js tours pricing --platform "$COMP" --poi "$POI" \
          || echo "(pricing failed for $COMP × $POI)"
      else
        # MODE=pricing — try pricing first; bootstrap on no_pinned.
        if node dist/cli.js tours pricing --platform "$COMP" --poi "$POI"; then
          : # ok
        else
          rc=$?
          if [ "$rc" = "2" ]; then
            echo "(no_pinned for $COMP × $POI — bootstrapping with scan + pin)"
            node dist/cli.js tours scan --platform "$COMP" --poi "$POI" \
              --keyword "$KW" --limit "$LIMIT" --sort-by "$SORT_BY" $SCREENSHOT_FLAG \
              || echo "(bootstrap scan failed)"
            node dist/cli.js tours pin --platform "$COMP" --poi "$POI" --top "$TOP" \
              || echo "(bootstrap pin failed)"
            node dist/cli.js tours pricing --platform "$COMP" --poi "$POI" \
              || echo "(bootstrap pricing failed)"
          else
            echo "(pricing failed for $COMP × $POI: rc=$rc)"
          fi
        fi
      fi
      echo
    done
    echo "=== $POI done ==="
    echo
  done

  # ── Sync local SQLite mirror to Supabase ──────────────────────
  echo "=== SYNC TO SUPABASE ==="
  node dist/cli.js tours sync-to-supabase >/dev/null 2>&1 \
    || echo "(supabase sync skipped — local SQLite remains source of truth)"
  echo

  # ── Report + push ─────────────────────────────────────────────
  echo "=== REGENERATE REPORT ==="
  node dist/cli.js tours export >/dev/null
  node dist/cli.js tours report >/dev/null 2>&1
  echo "report regenerated"
  echo

  echo "=== GIT PUSH ==="
  # Only push when the clone has a writable origin — colleagues who cloned
  # the public repo without push access will stop at the commit and keep
  # the data local (their own Vercel fork can auto-deploy if they set one).
  git add data/reports/latest.html data/reports/*.html data/exports/latest.csv data/host-info.json data/routine-config.json 2>/dev/null
  if git diff --cached --quiet; then
    echo "(no diff to commit)"
  else
    git commit -m "chore(tours): $MODE refresh $(date +%Y-%m-%d)" || echo "(commit failed)"
    if git push origin "$(git branch --show-current)" 2>&1; then
      echo "push ok"
    else
      echo "(push skipped — no write access or no remote; local commit kept)"
    fi
  fi

  echo
  echo "=== ALL DONE @ $(date -Iseconds) ==="
} >>"$LOG_FILE" 2>&1
