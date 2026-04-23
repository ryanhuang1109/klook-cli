# API-style command renaming — proposal

**Status**: Phase 1 shipped 2026-04-23. Aliases in place across all 4 platform adapters + top-level + tours. `get-packages` new command added. Old names still work. Phase 2 (doc migration) partially done — `docs/platform-capabilities.md` updated; skills still reference old names (non-breaking).

## Why consider this

Current command names are **terse** — `detail`, `pricing`, `search`, `ingest`, `export`, `report`. A maintainer with context understands them immediately; a fresh Claude Code session, a new colleague, or a subagent without the skill loaded has to guess.

jackwener's reference adapter uses RPC-style names (`sight-search`, `get-packages`) that are self-describing. Aligning with that convention gives us:

1. **Better subagent / scheduled-routine behavior** — commands are understandable without a skill being loaded.
2. **Lower onboarding cost** — new teammates don't need to remember that "detail" actually returns activity + packages + itinerary + sections.
3. **Mental-model transfer** — "get" / "list" / "ingest" / "export" verbs match REST/RPC conventions most devs already know.

The cost is real: skills, CLAUDE.md, cron prompts, and muscle memory all reference current names. Mitigation is to ship **aliases first** (zero breakage), migrate docs, then deprecate.

## Naming style

**Kebab-case** (`get-packages`, not `get_packages`). Matches the existing `ingest-from-golden`, `ingest-detail` style in this repo and is the Unix norm for shell subcommands. Snake_case is a Python/RPC thing; our CLI is node/commander.

Verb convention:
- **`get-*`** — fetch one resource (`get-activity`, `get-pricing-matrix`)
- **`list-*`** — enumerate (`list-trending`, `list-activities`)
- **`search-*`** — keyword query returning many results
- **`ingest-*`** — write into tours.db
- **`export-*`** / **`generate-*`** — produce artifacts outside the DB
- **`set-*`** — mutate a single record's attribute
- **`compare-*`** / **`find-*`** — analytical, not pure fetch

## Proposed mapping — per-platform CLI

| Current | Proposed | Rationale |
|---|---|---|
| `opencli <p> search <query>` | `opencli <p> search-activities <query>` | Object is explicit; matches `list-trending` verb family |
| `opencli <p> detail <id>` | `opencli <p> get-activity <id>` | Returns activity + packages + itinerary + sections — `get-activity` is accurate to the full payload (not just packages) |
| `opencli <p> pricing <id>` | `opencli <p> get-pricing-matrix <id>` | Structure is explicit |
| `opencli klook trending <city>` | `opencli klook list-trending <city>` | List verb |
| `opencli <p> probe <id>` | `opencli <p> debug-dump-dom <id>` | Purpose explicit; `probe` is a term only the author knows |
| `opencli <p> probe2 <url>` | `opencli <p> debug-dump-dom-after-date <url>` | ditto |

**Note on `get-packages` specifically**: our `detail` command returns more than packages (itinerary, sections, description, rating). Renaming to `get-packages` would be inaccurate. If you want a **narrower** command that returns only the package array, we should **add a new command** `get-packages` rather than rename `detail`.

## Proposed mapping — top-level (`node dist/cli.js`)

| Current | Proposed |
|---|---|
| `compare [name]` | `compare-poi [name]` |
| `compare-history <name>` | `get-poi-price-history <name>` |
| `poi add` | `add-poi` (promote to top-level) |
| `poi list` | `list-pois` |
| `poi remove` | `remove-poi` |

Promoting `poi add/list/remove` to top-level removes a needless subcommand group and matches AWS CLI / gcloud idioms (`aws s3api create-bucket`, not `aws s3api bucket create`). Optional — if you prefer the group, keep it.

## Proposed mapping — tours pipeline (`tours <cmd>`)

| Current | Proposed |
|---|---|
| `tours ingest <p> <id>` | `tours ingest-pricing <p> <id>` |
| `tours ingest-detail <p> <id>` | `tours ingest-from-detail <p> <id>` |
| `tours ingest-search <p> <kw>` | `tours ingest-top-from-search <p> <kw>` |
| `tours ingest-snapshot <p> <file>` | `tours ingest-from-snapshot <p> <file>` |
| `tours ingest-from-golden <csv>` | `tours ingest-from-planning-csv <csv>` |
| `tours run` | `tours run-daily-routine` |
| `tours export` | `tours export-csv` |
| `tours report` | `tours generate-report` |
| `tours list` | `tours list-activities` |
| `tours review-sku <id> <status>` | `tours set-sku-review-status <id> <status>` |
| `tours review-activity <id> <status>` | `tours set-activity-review-status <id> <status>` |
| `tours match-from-url <url>` | `tours find-cross-platform-match <url>` |

## Implementation phases

### Phase 1 — aliases (zero breakage, ~1 hour)

`commander.js` supports aliases. For each command, register both the new canonical name **and** the old name as an alias. Both work; nothing breaks.

```ts
program
  .command('get-activity <id>')
  .alias('detail')           // ← old name still works
  .description('Get an activity: packages, itinerary, sections, pricing snapshot')
  .action(...)
```

After Phase 1: every existing script / skill / cron still works, plus the new names work.

### Phase 2 — migrate docs (~2 hours)

- Update all 7 skills in `.claude/skills/opencli-*/` to use new names in examples
- Update `CLAUDE.md` command reference
- Update `docs/platform-capabilities.md`
- Update `docs/skill-template-platform.md`
- Update any scheduled routine prompts

Old names continue to work via aliases, but are no longer documented.

### Phase 3 — deprecation (optional, later)

- Add a `console.warn('[deprecated] "detail" is now "get-activity"')` on old-name invocations
- After a month of warnings, remove the aliases

## Risk / cost assessment

| Phase | Risk | Effort |
|---|---|---|
| 1 (aliases) | Near zero — adds, doesn't remove | ~1 hr for all platforms + tours |
| 2 (doc migration) | Low — docs only | ~2 hrs |
| 3 (deprecate) | Medium — needs audit for stray callers | TBD |

Scheduled routines / cron jobs survive Phases 1–2 untouched.

## Decisions needed from Ryan

1. **Go ahead with Phase 1 (aliases)?** Low cost, high upside, recoverable.
2. **Agree with the naming style (kebab-case, `get-*` / `list-*` / `ingest-*` verb families)?**
3. **Is renaming `detail` → `get-activity` the right call, or would you prefer to keep `detail` and add a **new narrower** `get-packages` command that returns only the package array?** Two different products.
4. **Promote `poi` subcommands to top-level?** (`add-poi` vs `poi add`.)
5. **Timing** — do Phase 1 now, or after trip/gyg/kkday skill owners have filled their stubs?

## Non-goals

- This proposal does **not** touch command behavior or output schema, only names.
- The API style change does not enable anything the current commands can't do.
- This is **not** a migration to an HTTP API — still a CLI, just with more self-documenting command names.
