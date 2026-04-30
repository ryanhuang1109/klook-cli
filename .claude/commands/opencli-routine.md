---
description: Run the daily tours orchestrator routine
---

Invoke the `opencli-routine` skill. It decides per (POI, platform) target whether to run `opencli-scan`, `opencli-pricing`, or both — and delegates accordingly.

Pre-flight: confirm Browser Bridge cookie is `en-US` (`node dist/cli.js tours preflight-locale`).

$ARGUMENTS
