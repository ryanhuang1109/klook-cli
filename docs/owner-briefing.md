# Platform Skill Owner Briefing (Simplified)

**For**: Trip / GYG / KKday owners
**Time budget**: ~30 min per person to fill, not hours.

---

## Reality check: the skill is already 90% written

The 3 platform stubs (`opencli-trip`, `opencli-getyourguide`, `opencli-kkday`) were **pre-filled from the source code** — commands, ID formats, URL patterns, DOM selectors, I/O schemas, Touchpoints are all already in.

**You do NOT write**:
- ❌ Section structure / headings
- ❌ Frontmatter
- ❌ I/O schema tables (that's in `docs/io-schemas.md`)
- ❌ Command examples / CLI invocations
- ❌ `src/clis/<p>/*.ts` file listing

**You DO write** (only 3 things, everything else is pre-filled):

1. **Owner field**: change frontmatter `Owner: TODO — assign a maintainer` → `Owner: <你的名字> <你的 email>`
2. **Quirks** section: add 2–3 things you've personally debugged that aren't obvious from code — calendar behavior, cookie issues, regional redirects, etc.
3. **Known failure modes** section: add 1–2 real symptoms you've seen + how to respond

That's it. Everything else is done.

---

## What "human-only knowledge" looks like

These are things **only you know** from real debugging — the code doesn't reveal them.

**Quirks** = stable facts about the platform (one-liner).
**Known failure modes** = "when I see X, I do Y" (one-liner per case).

Don't write paragraphs. Copy-paste a bullet and edit it — most of the work is done.

### Quirk templates — Trip (pick what applies, edit, delete the rest)

```md
- **<Symptom you'd describe to a teammate>**: <one-line detail or fix>.
```

Starter copy-paste:
- **Currency drift by geo**: Trip serves whatever currency the Browser Bridge cookie pins → downstream consumers must normalize before cross-platform compare.
- **Region redirect**: zh-TW locale sometimes redirects to zh-CN Ctrip (different DOM entirely) → pin Browser Bridge cookie to en-US.
- **Title pollution**: title div occasionally concatenates promotion copy after the real title → if titles look noisy, add a new suffix to the `Promotion` / `Duration:` slice in `detail.ts`.
- **SKU hydration lag**: if `get-pricing-matrix` returns empty packages[] on first try, the page loaded before SKU tabs rendered → retry once is usually enough.
- **`.m_ceil` dual-use**: SKU tabs and date cells share this class → the scraper filters on id-format (numeric vs YYYY-MM-DD), don't iterate raw.
- **`--compare-dates` tradeoff**: cheaper (no per-SKU click) but only gives the minimum-across-SKU per date → don't use when you need per-SKU granularity.

### Quirk templates — GYG

Starter copy-paste:
- **Language is a variant axis**: GYG exposes language via a dropdown, not a matrix cell → `packages[]` can have more entries than you'd expect; merge by language in `packages.available_languages`.
- **Datepicker modal close**: clicking outside the modal too fast during pricing scrape closes the picker → the scraper now waits 500ms before each click; if you hit this, increase the wait.
- **Check-availability → date input swap**: after the first date selection, the CTA button becomes a date input → re-open sequence differs; the scraper handles both, but probes must too.
- **Single-language tours**: some tours have no language dropdown at all → empty `languages: []` is expected, not a failure.
- **Currency by cookie**: whatever Bridge cookie pins → normalize before inserting into `skus.price_usd`.
- **"Top pick" / "Booked N times" badges**: these pollute titles → the scraper strips them, but if a new badge format ships, update the regex in `search.ts`.

### Quirk templates — KKday

Starter copy-paste:
- **Cold-bridge first request**: returns a skeletal page → retry once typically fixes it; if not, warm the bridge with any known-good request first.
- **"from" price is minimum**: `get-pricing-matrix` output `price` is the cheapest across sub-SKUs, not per-tier → do not compare directly against Klook adult/child tiers; normalize first.
- **Package tab ordering**: Admission → Bundle → VIP is the UI order and the scraper preserves it → if downstream dedupes by title alone, same-named packages across tiers can collapse incorrectly.
- **Locale subpath rewrite**: URLs with `/zh-tw/` are rewritten to `/en/` before scraping → the stored `canonical_url` is always the `/en/` variant.
- **Booking counter absence**: newer products have no "X+ travelers booked" label → empty `order_count` is expected, not a scraper bug.
- **Calendar lazy-mount**: calendar renders after "Select" click with a short animation → scraper waits, but aggressive anim changes break it; symptom is "package found, dates empty".

### Known failure mode templates (symptom → response)

```md
- **<Symptom visible in output or logs>**: <how to respond — flag? retry? escalate?>.
```

Starter copy-paste (applies to most platforms, edit):
- **`packages[]` length = 0 but HTTP 200**: scraper ran, page was empty → `tours set-activity-review-status <id> flagged --note "empty packages on <date>"`, do not auto-retry.
- **Price field contains "TBD" / "Sold out" / empty**: SKU exists but not bookable → store `availability: "unknown"`, don't treat as price-zero.
- **Review count drops by >50% day-over-day**: likely the adapter is hitting a different locale → abort run, check cookie pin.
- **Currency mismatch vs previous run**: normalize or flag → do not cross-compare raw `price_local`.
- **Same `platform_package_id` but different `name`**: platform renamed a package → upsert by `platform_package_id`, update `title`, don't create a duplicate row.

---

## How to write YOUR own (if none above fit)

Good quirk: short, specific, actionable. Bad quirk: generic programming advice.

| ✅ Good | ❌ Bad |
|---|---|
| "KKday `/en/` pins USD; `/zh-tw/` pins TWD — never mix in one run" | "Be careful with locales" |
| "Datepicker closes if outer click within 500ms" | "UI can be fragile" |
| "Review count 'Coming soon' = unavailable, don't flag as missing" | "Some fields may be empty" |

Aim for: 1 observation → 1 consequence → 1 action. If you can't fit it on one line, it probably isn't a quirk — it's a whole new section.

---

## 30-minute checklist

Do these in order:

### 1. Open your skill file
```
.claude/skills/opencli-trip/SKILL.md         # Trip owner
.claude/skills/opencli-getyourguide/SKILL.md # GYG owner
.claude/skills/opencli-kkday/SKILL.md        # KKday owner
```

### 2. Change Owner in frontmatter (literally one line edit)

Find:
```
- **Owner**: TODO — assign a maintainer (prefilled scaffold by Ryan from source code)
```

Replace with:
```
- **Owner**: 你的名字 (you@klook.com)
```

### 3. Test that the skill loads + scraping works

In Claude Code, type:
```
/opencli-<your-platform> <a-known-good-id>
```

Examples:
- `/opencli-trip 92795279`
- `/opencli-getyourguide t54321`
- `/opencli-kkday 2247`

Watch what happens. If Claude invokes the skill + returns valid JSON, you're 80% done.

### 4. Read through the pre-filled content & flag anything wrong

Open your `SKILL.md` and skim the **Quirks** + **Known failure modes** + **Fallback playbook** sections. They were written from source code — they might miss real-world nuance.

For each section, ask:
- "Is this accurate from my experience?"
- "Is there a failure I've seen that's not listed?"
- "Is the fallback playbook in the right order?"

Edit / add / reorder as needed. Keep edits small — one bullet per real observation.

### 5. Add platform-specific calendar / scraping tips (if applicable)

Things the code can't tell us, but you know:
- How the calendar widget actually behaves (not what selector it uses — how it responds under load / cold start / bad cookies)
- Peak hours when scraping is unreliable
- Locale / currency gotchas
- Specific IDs that are known-good for testing

Add 1–3 lines to **Quirks**. Don't write paragraphs.

### 6. Validate

```bash
python3 ~/.claude/plugins/cache/anthropic-agent-skills/document-skills/unknown/skills/skill-creator/scripts/quick_validate.py \
  .claude/skills/opencli-<your-platform>
```
Expected: `Skill is valid!`

### 7. PR it

One PR per owner, title like `chore(skill): assign opencli-trip owner + add quirks from experience`.

---

## Commands your skill covers (for reference only — already documented in the skill)

| Command | What it does |
|---|---|
| `search-activities` | keyword → list of activities |
| `get-activity` | ID → full payload (title, packages, itinerary, sections, rating) |
| `get-packages` | ID → just packages[] (lighter) |
| `get-pricing-matrix` | ID → package × date price matrix (7 days) |

Input and output field names are in `docs/io-schemas.md`. **You don't need to document them** — just know they exist so your examples reference them correctly.

---

## If you hit something broken

Do **NOT** fix scraper bugs in the skill file. Skills are prompts, not code.

- **Adapter bug** (wrong selector, wrong ID parse): fix `src/clis/<p>/<cmd>.ts`, `npm run build`, retest. Mention the fix commit in your skill's `Known failure modes` if it was a recurring issue.
- **Scraper working but output weird**: mention it in Quirks.
- **Scraper fundamentally broken**: open a GitHub issue + mark `Owner` as blocked.

---

## Questions for the meeting

1. Who owns Trip / GYG / KKday? (3 assignments needed.)
2. Can everyone commit to the 30-minute checklist by end of this week?
3. Any scraping issues currently broken that should be fixed in the adapter before skills are considered "done"?

---

## TL;DR

```
┌─────────────────────────────────────────────────────────┐
│  3 things to fill:                                       │
│    1. Owner frontmatter line                             │
│    2. 2-3 Quirks bullets from your experience            │
│    3. 1-2 Known failure modes from what you've seen      │
│                                                          │
│  Test:   /opencli-<your-platform> <id>                   │
│  File:   .claude/skills/opencli-<your-platform>/SKILL.md │
│  Ref:    .claude/skills/opencli-klook/SKILL.md           │
│                                                          │
│  Time:   ~30 min                                         │
└─────────────────────────────────────────────────────────┘
```
