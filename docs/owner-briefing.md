# Briefing: New Split of Responsibilities

**Effective 2026-04-24.**

Previous assumption: colleagues would own per-platform skill files (`opencli-trip`, `opencli-getyourguide`, `opencli-kkday`) and fill in platform quirks.

**New direction**: colleagues own **listing-page discovery** (finding activity URLs from category pages). Core team owns **per-platform scraping skills** (they stay where they are).

One handshake between the two: `data/golden/pricing-tna-planning.csv`. Full contract in `docs/colleague-handoff.md` — read that.

---

## What each side does

### BD / listing team (colleagues)

Produce activity URLs for us to scrape. Use your existing skills:

- `competitors-listing-urls-crawler`
- `gyg-listing-scraper`
- `kkday-listing-scraper`
- (add more as needed for new platforms)

**Deliverable per sweep**: appended rows in `data/golden/pricing-tna-planning.csv`. Must-fill columns:

| Col | Field | Example |
|---|---|---|
| 1 | OTA | `Klook` / `Trip` / `Getyourguide` / `Kkday` |
| 2 | Main POI | `Mount Fuji` |
| 11 | Lowest_Price_AID (URL) | `https://www.klook.com/en-US/activity/93901-.../` |

Optional (strongly recommended for provenance):

| Col | Field | Example |
|---|---|---|
| 16 | Listing_URL | `https://www.klook.com/en-US/search/mt-fuji/` |
| 17 | Discovered_By | `apac-bd-team` |
| 18 | Discovered_At | `2026-04-24` |
| 19 | Theme | `day trip` |

Columns 3–9, 12–14 blank. Our CLI fills those after scraping.

### Core team (us)

After each CSV PR merges:

```bash
node dist/cli.js tours ingest-from-planning-csv data/golden/pricing-tna-planning.csv
node dist/cli.js tours export-csv
node dist/cli.js tours generate-report
```

Results land in `data/tours.db` + `data/exports/<today>.csv` + `data/reports/latest.html`.

---

## What no longer applies

Earlier drafts of this briefing asked platform owners to fill `## Quirks` / `## Known failure modes` / `Owner` fields in `opencli-trip` / `opencli-getyourguide` / `opencli-kkday`. **Skip that.** Those skills are now core-team-maintained. Colleagues don't need to touch `.claude/skills/`.

The quirk templates (formerly here) remain useful reference for us when documenting scraper quirks — moved inline into the individual platform skills.

---

## Meeting talking points

1. **Confirm the split** — does the listing side accept the "append to planning CSV" interface?
2. **Clarify de-dup ownership** — if colleague A finds activity 93901 via Bangkok sweep and colleague B finds it via Mt Fuji sweep, should the CSV dedupe before merge, or let the ingester dedupe by `(platform, activity_id)` (current behavior)?
3. **POI naming convention** — do we need a canonical POI list (`Mount Fuji`, not `Mt. Fuji` or `富士山`) to prevent DB fragmentation?
4. **Sweep cadence** — daily, weekly, on-demand?
5. **Failure feedback loop** — if our ingest fails on a URL a colleague added (bad URL, scraper broken), where does the report go?

---

## Reference

- **Full contract**: `docs/colleague-handoff.md`
- **I/O schemas** (what each scrape returns): `docs/io-schemas.md`
- **Platform capabilities** (command reference): `docs/platform-capabilities.md`
- **Platform skills** (core-team maintained, for our reference): `.claude/skills/opencli-{klook,trip,getyourguide,kkday}/SKILL.md`

---

## TL;DR

```
┌───────────────────────────────────────────────────────────┐
│  Colleagues: find activity URLs via listing crawlers      │
│  Handoff:    append rows to data/golden/pricing-tna-      │
│              planning.csv with OTA + POI + activity URL   │
│              (+ optional Listing_URL / Discovered_By /    │
│              Discovered_At / Theme in columns 16–19)      │
│  Core team:  tours ingest-from-planning-csv → DB → report │
│                                                            │
│  Full spec:  docs/colleague-handoff.md                    │
└───────────────────────────────────────────────────────────┘
```
