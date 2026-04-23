---
description: Run the daily tours ingest → export → report pipeline (manual trigger)
argument-hint: [--destination <city> --keyword <theme>]
---

Invoke the `opencli-tours-routine` skill and execute the full 6-step playbook.

If `$ARGUMENTS` is empty, assume the routine's default: read `data/golden/pricing-tna-planning.csv` for targets.

If `$ARGUMENTS` contains `--destination` / `--keyword`, route through `tours run-daily-routine` instead of the golden CSV path.

Before starting: confirm `data/tours.db` exists and read the current `review_status = 'rejected' | 'flagged'` rows so rejected activities are skipped and flagged notes are honored.

After finishing: report targets attempted/succeeded/failed per platform, paths of `data/exports/<today>.csv` and `data/reports/latest.html`, and any auto-flagged SKUs (>30% price move).

$ARGUMENTS
