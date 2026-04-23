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

Examples of things **only you know**, that the code doesn't reveal:

- "Trip's zh-TW locale sometimes redirects to zh-CN Ctrip — pin to en-US"
- "KKday calendar needs 3-second wait after 'Select' click on cold bridge"
- "GYG's datepicker closes itself if you click outside the modal too quickly"
- "When review_count shows 'Coming soon', the activity is actually unavailable"
- "Price 'TBD' means the SKU exists but isn't bookable this week"
- "Prices in CNY hint that you accidentally loaded zh-CN — abort"

These go into **Quirks** (stable tips) or **Known failure modes** (symptom → response).

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
