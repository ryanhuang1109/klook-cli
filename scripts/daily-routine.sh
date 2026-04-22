#!/bin/bash
# Daily tours competitor refresh — invoked by system cron (or Claude routine).
#
# POIs and knobs are defined in data/routine-config.json so this script never
# needs editing when you add/remove a POI. Just edit the JSON and push.

set -u

REPO="/Users/ryan.huang/Documents/klook/klook-cli"
CONFIG="$REPO/data/routine-config.json"
LOG_DIR="$REPO/data/routine-logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# cron runs with a minimal env — hardcode nvm node path.
NODE_BIN="/Users/ryan.huang/.nvm/versions/node/v22.18.0/bin"
export PATH="$NODE_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$REPO" || { echo "[$(date)] ERROR: cd $REPO failed" >>"$LOG_FILE"; exit 1; }

{
  echo "=========================================="
  echo "=== daily-tours-refresh @ $(date -Iseconds) ==="
  echo "=========================================="
  echo "node: $(which node) ($(node --version))"
  echo "opencli: $(which opencli)"
  echo "config: $CONFIG"
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
  SCREENSHOT_FLAG=$(node -e 'console.log(require(process.argv[1]).screenshot ? "--screenshot" : "")' "$CONFIG")

  echo "competitors: $COMPETITORS"
  echo "limit: $LIMIT  sort: $SORT_BY  screenshot: ${SCREENSHOT_FLAG:-off}"
  echo

  # ── Run each POI ──────────────────────────────────────────────
  # Emit one tab-separated line per POI from the JSON, then iterate.
  node -e '
    const cfg = require(process.argv[1]);
    for (const p of cfg.pois) console.log([p.destination, p.keyword, p.poi].join("\t"));
  ' "$CONFIG" | while IFS=$'\t' read -r DEST KW POI; do
    echo "=========================================="
    echo "=== POI: $POI (dest=$DEST, kw=\"$KW\") ==="
    echo "=========================================="
    node dist/cli.js tours run \
      --destination "$DEST" --keyword "$KW" \
      --competitors "$COMPETITORS" \
      --limit "$LIMIT" --sort "$SORT_BY" \
      $SCREENSHOT_FLAG
    echo "=== $POI done ==="
    echo
  done

  # ── Report + push ─────────────────────────────────────────────
  echo "=== REGENERATE REPORT ==="
  node dist/cli.js tours export >/dev/null
  node dist/cli.js tours report >/dev/null 2>&1
  echo "report regenerated"
  echo

  echo "=== GIT PUSH ==="
  git add data/reports/latest.html data/reports/*.html data/exports/latest.csv 2>/dev/null
  if git diff --cached --quiet; then
    echo "(no diff to commit)"
  else
    git commit -m "chore(tours): daily refresh $(date +%Y-%m-%d)" \
      && git push origin main 2>&1 \
      && echo "push ok"
  fi

  echo
  echo "=== ALL DONE @ $(date -Iseconds) ==="
} >>"$LOG_FILE" 2>&1
