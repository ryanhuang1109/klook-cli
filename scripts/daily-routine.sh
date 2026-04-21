#!/bin/bash
# Daily tours competitor refresh — invoked by system cron at 10:03 local.
#
# Why this script instead of inlining in the crontab entry:
#   - cron runs with a minimal env: $PATH, $HOME etc. may not include nvm.
#   - Having the script version-controlled means the cron entry never needs
#     to change when we tweak the routine.
#   - Logs go to one known path for debugging.
#
# The script is idempotent: re-running mid-day is safe.

set -u  # error on unset vars; don't use -e so we can log and continue

REPO="/Users/ryan.huang/Documents/klook/klook-cli"
LOG_DIR="$REPO/data/routine-logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# nvm-installed Node — crontab inherits nothing, hardcode the path.
NODE_BIN="/Users/ryan.huang/.nvm/versions/node/v22.18.0/bin"
export PATH="$NODE_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$REPO" || { echo "[$(date)] ERROR: cd $REPO failed" >>"$LOG_FILE"; exit 1; }

{
  echo "=========================================="
  echo "=== daily-tours-refresh @ $(date -Iseconds) ==="
  echo "=========================================="
  echo "node: $(which node) ($(node --version))"
  echo "opencli: $(which opencli)"
  echo

  echo "=== PRE-FLIGHT ==="
  if ! opencli doctor >/dev/null 2>&1; then
    echo "! opencli doctor failed — aborting"
    opencli doctor
    exit 2
  fi
  echo "opencli doctor: ok"

  if [ ! -f .env.development.local ]; then
    echo "! .env.development.local missing — aborting"
    exit 2
  fi
  echo "env: ok"
  echo

  # Run each POI. Limit=10 keeps each POI under ~15 min.
  for pair in \
      "tokyo|mt fuji|Mount Fuji" \
      "kyoto|kiyomizu temple|Kiyomizu Temple" \
      "seoul|dmz|DMZ"
  do
    IFS='|' read -r DEST KW POI <<<"$pair"
    echo "=== POI: $POI (dest=$DEST, kw=\"$KW\") ==="
    node dist/cli.js tours run \
      --destination "$DEST" --keyword "$KW" \
      --competitors klook,trip,getyourguide,kkday \
      --limit 10 --screenshot --sort reviews
    echo "=== $POI done ==="
    echo
  done

  echo "=== REGENERATE AGGREGATE REPORT ==="
  node dist/cli.js tours export >/dev/null
  node dist/cli.js tours report >/dev/null 2>&1
  echo "report regenerated"
  echo

  echo "=== GIT PUSH ==="
  # Only commit if something actually changed.
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
