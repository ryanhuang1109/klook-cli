#!/bin/bash
# Daily tours competitor refresh — invoked by system cron (or Claude routine).
#
# POIs and knobs are defined in data/routine-config.json so this script never
# needs editing when you add/remove a POI. Just edit the JSON and push.
#
# Portable: locates the repo from the script's own path (no hardcoded user
# dir) and discovers Node via common install locations. Works on any macOS
# or Linux box that has cloned this repo and either nvm-installed or
# homebrew/system-installed Node 20+.

set -u

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
  echo "=========================================="
  echo "node: $(which node) ($(node --version))"
  echo "opencli: $(which opencli)"
  echo "config: $CONFIG"
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
  # Only push when the clone has a writable origin — colleagues who cloned
  # the public repo without push access will stop at the commit and keep
  # the data local (their own Vercel fork can auto-deploy if they set one).
  git add data/reports/latest.html data/reports/*.html data/exports/latest.csv data/host-info.json 2>/dev/null
  if git diff --cached --quiet; then
    echo "(no diff to commit)"
  else
    git commit -m "chore(tours): daily refresh $(date +%Y-%m-%d)" || echo "(commit failed)"
    if git push origin "$(git branch --show-current)" 2>&1; then
      echo "push ok"
    else
      echo "(push skipped — no write access or no remote; local commit kept)"
    fi
  fi

  echo
  echo "=== ALL DONE @ $(date -Iseconds) ==="
} >>"$LOG_FILE" 2>&1
