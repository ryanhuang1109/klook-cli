---
description: Run an opencli getyourguide scan/pricing/all task on a POI
argument-hint: <poi> <scan|pricing|all>   (alias: detail = scan)
---

Invoke the `opencli-getyourguide` skill scoped to getyourguide.

**Input contract:** `<poi> <mode>` where mode is one of `scan | pricing | all`.
The token `detail` is accepted as an alias for `scan`.

**Step 1 — Parse args:**
```bash
node dist/cli.js tours parse-slash-args $ARGUMENTS
```

Branch on the JSON result:

- `kind: "ok"` → continue with the `poi` and `mode` returned.
- `kind: "ask"` → present `question` + numbered `choices` to the user and STOP. Do **not** pick a default.
- `kind: "error"` → print `message` and STOP.

**Step 2 — Pre-flight:** `opencli doctor`.
Confirm the Browser Bridge cookie locale is `en-US` (per memory `feedback_browser_bridge_en_us`). Adapters are written against en-US DOM and zh-TW silently breaks them.

**Step 3 — Dispatch:**

| mode    | command                                                                        |
|---------|--------------------------------------------------------------------------------|
| scan    | `node dist/cli.js tours scan --platform getyourguide --poi "<poi>"`            |
| pricing | `node dist/cli.js tours pricing --platform getyourguide --poi "<poi>"`         |
| all     | `tours scan ...` then `tours pin --top 5` then `tours pricing ...`             |

**Step 4 — Handle pricing's "no_pinned" branch:**

If `tours pricing` returns `"no_pinned": true` (exit code 2), **do not
auto-fallback**. Surface the choice to the user verbatim:

```
No pinned activities for getyourguide × <poi>. Pick:
  1) /opencli-getyourguide <poi> all
  2) /opencli-getyourguide <poi> scan         (then pin later)
  3) tours pin --platform getyourguide --poi <poi> --top 5
  4) cancel
```

**getyourguide-specific quirks** (see `opencli-getyourguide` skill for full troubleshooting):
- GYG treats language as a first-class variant axis — expect more `packages[]` entries than a naïve matrix. No `trending` command.

$ARGUMENTS
