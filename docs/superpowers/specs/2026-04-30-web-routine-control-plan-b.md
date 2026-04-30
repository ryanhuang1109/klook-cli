# Web Routine Control — Plan B (Hybrid Request Queue)

**Status:** spec, not yet implemented.
**Depends on:** PR #4 (Plan A — config in Supabase, web edit form, cron uses scan/pin/pricing).

## Goal

Two missing capabilities Plan A doesn't ship:

1. **Run-now button on the web** — push a button on `/schedule`, the routine fires for a chosen scope (POI × competitor × mode) without waiting for the next cron tick.
2. **Cron control from the web** — edit when/how-often, not just what. Replaces the user's system `crontab -e` for this project.

Plan A only handles "what" (config). Plan B handles "when" and "now".

## The architectural constraint that shapes everything

The browser-bridge scrapers (trip / gyg / kkday) only run on Daisy's Mac because the Browser Bridge daemon hooks her real Chrome via Chrome extension. **Vercel cannot run them.** This rules out:

- Web button → Vercel function → tours scan (no bridge → fails)
- Vercel Cron Jobs (same reason)
- Migrating scrapers to Browserless cloud (significant Chrome-extension rewrite, separate decision)

So the design has to be: **web (Vercel) plays orchestrator; Daisy's Mac plays worker**.

## Architecture

```
┌──────────────────────┐                ┌──────────────────────┐
│  Web (Vercel)        │                │  Daisy's Mac         │
│  /schedule page      │                │  routine-daemon      │
│                      │                │  (long-running)      │
│  [Run-now] button    │   write        │                      │
│  Cron editor         ├───────┐        │  every 30s:          │
│  Status panel        │       │        │   poll Supabase      │
└──────────┬───────────┘       ▼        │   for runnable jobs  │
           │              ┌─────────┐   │                      │
           │     read     │Supabase │   │  on hit:             │
           └──────────────┤         ├───┤   shell out to       │
                          │ tables  │   │   tours scan/pin/    │
                          │         │   │   pricing            │
                          │ ...     │   │                      │
                          │         │◄──┤  write status +      │
                          └─────────┘   │  results back        │
                                        └──────────────────────┘
```

Daisy's Mac runs a single long-running Node daemon (`scripts/routine-daemon.js`) that replaces system cron for this project. The daemon owns three responsibilities:

- **Cron scheduling** — read schedule rows from Supabase; fire jobs by their `next_run_at`.
- **Run-now queue** — read `routine_requests` rows with status=`pending`; pick up and run.
- **Status mirror** — write progress back to Supabase so the web shows live status.

Existing system cron stays for any non-tours work; this daemon only owns the tours pipeline.

## New Supabase tables

### `routine_schedules`

Replaces the user's crontab entries for tours work.

```sql
CREATE TABLE public.routine_schedules (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name          text NOT NULL,                    -- e.g. "daily pricing", "weekly scan"
  mode          text NOT NULL CHECK (mode IN ('pricing', 'scan', 'all')),
  cron          text NOT NULL,                    -- standard 5-field cron expression
  poi_filter    text[],                           -- null = all POIs from routine_config
  platform_filter text[],                         -- null = all competitors from routine_config
  enabled       boolean NOT NULL DEFAULT true,
  next_run_at   timestamptz,                      -- daemon updates after each fire
  last_run_at   timestamptz,
  last_status   text,                             -- 'ok' | 'failed' | 'partial'
  last_session_id bigint,                         -- FK to run_sessions (informational)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);
```

RLS: `service_role` write, `authenticated` read.

### `routine_requests`

The "Run-now" queue.

```sql
CREATE TABLE public.routine_requests (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  mode          text NOT NULL CHECK (mode IN ('pricing', 'scan', 'all', 'pin')),
  poi           text NOT NULL,                    -- 'Mount Fuji' or '*' for all
  platform      text NOT NULL,                    -- 'kkday' or '*' for all
  pin_top       int,                              -- only used when mode=pin or mode=all
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by  text,                             -- web user email or 'cron:<schedule-id>'
  requested_at  timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  result_json   jsonb,                            -- the JSON tools-CLI returns
  error_message text,
  /** Daemon-side soft lock: which worker took it. null=unclaimed. */
  claimed_by    text,
  claimed_at    timestamptz
);

CREATE INDEX ON public.routine_requests (status, requested_at) WHERE status IN ('pending','running');
```

RLS: `service_role` write, `authenticated` read.

## Daemon

`scripts/routine-daemon.js` (or `.ts` compiled).

### Responsibilities

```pseudo
loop forever:
  every 30s:
    # 1. fire scheduled jobs
    for each enabled schedule where next_run_at <= now:
      INSERT routine_requests (mode, poi='*', platform='*', requested_by='cron:<id>')
      UPDATE routine_schedules SET next_run_at = compute_next(cron, now), last_run_at = now

    # 2. claim and run pending requests (one at a time per worker)
    claim = UPDATE routine_requests
            SET status='running', claimed_by=hostname(), claimed_at=now,
                started_at=now
            WHERE id = (SELECT id FROM routine_requests
                        WHERE status='pending' AND claimed_by IS NULL
                        ORDER BY requested_at LIMIT 1
                        FOR UPDATE SKIP LOCKED)
            RETURNING *
    if claim:
      try:
        result = execute_request(claim)   # shells out to tours scan/pin/pricing
        UPDATE routine_requests SET status='succeeded', result_json=result, finished_at=now
      catch err:
        UPDATE routine_requests SET status='failed', error_message=err.message, finished_at=now
```

### Cron expression evaluation

Use `cron-parser` (npm) or write a tiny 5-field parser. cron-parser is ~25KB and battle-tested.

### Heartbeat / liveness

Daemon writes a `host-info.json` row to Supabase (or to a dedicated `routine_daemon_heartbeats` table) every minute. Web Schedule page can show "Daemon: ✓ online (last beat 12s ago)" or "✗ offline (last beat 4h ago — your Mac asleep?)".

### Single-instance enforcement

If two daemons run by accident (e.g. Daisy starts a second one in another terminal), they race on the `claimed_by` column — the SKIP LOCKED in the claim query ensures only one wins per request, but both will still poll. Acceptable; or add a `routine_daemons` table with a row-per-host and refuse to start if another host claims `is_active=true` within the last 90s.

### Lifecycle

Run via `launchctl` (macOS) or `systemd` (Linux). Provide install scripts:

```bash
scripts/install-daemon-launchd.sh    # macOS — generates ~/Library/LaunchAgents/com.klook-cli.routine.plist
scripts/install-daemon-systemd.sh    # Linux — generates ~/.config/systemd/user/klook-cli-routine.service
```

## Web UI additions

### `/schedule` page additions

#### "Run now" panel (top, above existing form)

```
┌─ Run now ───────────────────────────────────────────────┐
│  Mode: [scan▾] [pricing] [all]                          │
│  POI:  [Mount Fuji▾] [Kiyomizu Temple] [DMZ] [all]      │
│  Platform: [klook] [trip] [getyourguide] [kkday] [all]  │
│  [pin top: 5] (only when mode=all or pin)               │
│                                            [Run]──────► │
└─────────────────────────────────────────────────────────┘
```

Submitting writes a `routine_requests` row. Page polls (every 3s) until status changes to `succeeded`/`failed`. Show inline progress.

#### "Schedules" section (replaces the static "Cron suggestions" block)

```
Schedules
┌───────────────────────────────────────────────────────────────┐
│ name              cron          mode      enabled  next run    │
├───────────────────────────────────────────────────────────────┤
│ daily pricing     0 9 * * *     pricing   ✓        in 4h 12m   │
│ weekly scan       0 10 * * 0    scan      ✓        in 2d 22h   │
│ ...                                                           │
└───────────────────────────────────────────────────────────────┘
[+ Add schedule]
```

Each row: edit / disable / delete. Edit opens a modal with cron expression + mode + filters. Validate cron via `cron-parser` server-side.

#### "Recent requests" section

The bottom Sessions table is repurposed to show `routine_requests` (last 50). Columns: requested_at, mode, scope (POI × platform), status, duration. Click → expand JSON result.

#### "Daemon" indicator (header strip)

A small pill next to the page title: `● Daemon online (12s ago)` (green) or `● Daemon offline 4h` (red). Reads from heartbeat data.

## Implementation tasks (rough order)

| # | Task | LoC est | Risk |
|---|---|---|---|
| 1 | Supabase migrations: `routine_schedules` + `routine_requests` + heartbeat | 60 | low |
| 2 | Daemon skeleton (poll loop + claim + execute) | 200 | medium — concurrency edge cases |
| 3 | Daemon cron evaluator (or wire `cron-parser`) | 30 | low |
| 4 | Daemon heartbeat write | 20 | low |
| 5 | macOS launchd install script | 30 | low |
| 6 | Linux systemd install script | 30 | low |
| 7 | Web — Run-now panel + server action | 80 | low |
| 8 | Web — Schedule CRUD UI | 200 | medium — form validation, modal UX |
| 9 | Web — Requests list + polling | 100 | low |
| 10 | Web — Daemon status pill | 30 | low |
| 11 | Cleanup: deprecate `daily-routine.sh` from cron, point users to daemon | 20 | low |
| **Total** | | **~800** | |

## Open decisions

1. **Daemon language** — Node (matches the rest of the CLI; reuses `loadEnv`, `getSupabaseClient`) or a lighter shell loop calling the existing CLI? Recommend Node for testability and shared imports.
2. **Single worker vs concurrency** — first cut: single worker per host, one request at a time. Concurrency would be tempting (5 platforms × 30 POIs serial = slow) but adds Browser-Bridge contention risk. Defer until proven slow.
3. **Schedule cron expression UX** — raw cron field (geek-friendly), preset dropdowns ("every day at 9am", "every Sunday at 10am"), or both? Recommend preset dropdown + "advanced (cron)" reveal.
4. **Cancellation** — should `routine_requests` support a `cancel` action while running? Adds complexity (daemon must check periodically + abort the spawned `tours` process). Defer to later sprint.
5. **Per-(POI × platform) request granularity** — current design supports `*` wildcards. Daemon expands wildcards client-side at execution time. Alternative: web fans out to multiple narrow requests on Run-now click. Wildcard is simpler.
6. **Auth for the daemon** — the daemon uses service-role key (server-only secret on Daisy's Mac). Document the same key location as `.env.development.local`. Don't share with the Vercel deploy except via `vercel env`.

## What this does NOT cover

- Migrating scrapers off Daisy's Mac (Plan C). If/when Plan C lands, the daemon disappears and Vercel Cron + serverless functions take over. Plan B's Supabase schema (schedules + requests) is forward-compatible — Vercel Cron can write to the same tables.
- Multi-user collaboration (multiple people editing schedules at once). Last-writer-wins is fine for a 5-person team.
- Audit log of every config change. `updated_by` + `updated_at` on each table is enough for now.

## Effort estimate

Calendar: ~3–5 working days for one engineer including testing.

Suggested split:
- **Day 1:** Supabase migrations + daemon skeleton + heartbeat (#1-4)
- **Day 2:** macOS install script + first end-to-end (Run-now from CLI) (#5)
- **Day 3:** Web Run-now panel + Requests list (#7, #9)
- **Day 4:** Web Schedule CRUD (#8)
- **Day 5:** Daemon status pill, polish, deprecation note for daily-routine.sh (#10, #11)

## Risks / gotchas

- **Daemon dies silently on Mac sleep.** launchd resurrects it on wake but in-flight requests will be marked `failed` after a timeout grace period. Document this behaviour.
- **Browser Bridge crashes mid-request.** Daemon catches the spawn failure and reports as `failed`. Operator manually retries via web (or schedule fires again).
- **Schedule firing during an outage.** If Supabase is unreachable, the daemon backs off (exponential, max 5 min) and resumes. Schedules drift slightly but eventually catch up.
- **Concurrent daemons (two Macs, or laptop + desktop).** Both can poll, but `SKIP LOCKED` ensures each request runs exactly once. Heartbeat lets the web show which host last claimed work.

## Acceptance criteria

- [ ] Daisy can click "Run now" on `/schedule` and watch a kkday × Mount Fuji pricing run finish in <2 min, with results visible on Activities/SKUs pages.
- [ ] Daisy can add a schedule "weekly scan, Sundays 10am, all POIs, all platforms" via the web UI; verify it fires the next Sunday.
- [ ] Daisy can disable a schedule via toggle; verify it doesn't fire.
- [ ] Daemon survives a Mac restart (launchd) and resumes polling.
- [ ] System `crontab` no longer needs the `scripts/daily-routine.sh` entry.
