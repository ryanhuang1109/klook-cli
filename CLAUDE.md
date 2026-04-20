# Travel Competitor Monitor — Claude Code Instructions

You have access to a travel activity CLI that searches and compares prices across 4 platforms: Klook, Trip.com, GetYourGuide, and KKday.

## Available Commands

### Search activities on a single platform

```bash
opencli klook search "<keyword>" --limit <N>
opencli trip search "<keyword>" --limit <N>
opencli getyourguide search "<keyword>" --limit <N>
opencli kkday search "<keyword>" --limit <N>
```

Always use `-f json` for structured output you can parse:

```bash
opencli klook search "Mt Fuji day tour" --limit 5 -f json
```

### Get activity detail (itinerary, packages, pricing)

```bash
opencli klook detail <activity-id> -f json
opencli trip detail <activity-id> -f json
opencli getyourguide detail "<full-url>" -f json
opencli kkday detail <product-id> -f json
```

For Trip.com, you can compare prices across multiple dates:

```bash
opencli trip detail <activity-id> --compare-dates -f json
```

### Cross-platform AI comparison

First check configured POIs:

```bash
node dist/cli.js poi list
```

Run comparison for a POI:

```bash
node dist/cli.js compare "<POI name>" --date <YYYY-MM-DD> -f json
```

Run all POIs at once:

```bash
node dist/cli.js compare --all --date <YYYY-MM-DD> --save -f json
```

View price history:

```bash
node dist/cli.js compare-history "<POI name>" --days 7
```

### Manage POIs

```bash
node dist/cli.js poi add "<name>" --keywords "<kw1>,<kw2>" --platforms klook,trip,getyourguide,kkday
node dist/cli.js poi list
node dist/cli.js poi remove "<name>"
```

## Important Notes

- Klook search uses a public API and is fast (<1s). Other platforms use Browser Bridge and take ~10s each.
- Always use `-f json` when you need to parse the output programmatically.
- The `compare` command searches all platforms and calls an LLM to cluster results. It can take 1-3 minutes.
- Activity IDs come from search results. Klook uses numeric IDs (e.g., 93901). KKday uses product IDs (e.g., 2247). Trip.com uses detail IDs (e.g., 92795279). GetYourGuide uses full URLs.
- Strip any "Update available" lines from opencli output before parsing JSON.

## Workflow for User Requests

When users ask about travel activities or prices:

1. **Search** the relevant platforms to find activities
2. **Get details** for specific activities if the user wants itinerary/packages/pricing
3. **Compare** across platforms if the user wants to find the best deal
4. **Present results** in a clear table format with platform, price, rating, and links

When users ask you to monitor or track prices:

1. **Add a POI** with relevant keywords
2. **Run compare** with `--save` to store the baseline
3. Explain they can run `compare` again later (or via cron) to track changes

## Extending the Tool

### Adding a new platform (e.g. Viator, Expedia, Airbnb Experiences)

Each platform lives in `src/clis/<name>/` as a standalone opencli plugin with the same three commands: `search`, `detail`, `trending`. The build compiles to `dist/clis/<name>/` which is symlinked into `~/.opencli/plugins/<name>/`.

Steps to add a new platform — you can do these yourself without asking the user to touch anything:

1. **Copy an existing adapter as template.** Klook is a public-API adapter (`Strategy.PUBLIC`, no browser). Trip/GYG/KKday are Browser Bridge adapters that scrape DOM (`Strategy.BROWSER_BRIDGE`). Pick whichever matches the new site:
   ```bash
   cp -r src/clis/klook src/clis/viator        # if target has a public API
   cp -r src/clis/kkday src/clis/viator        # if you need to scrape DOM
   ```

2. **Rewrite `search.ts` and `detail.ts`** — the shape they must return is defined in `src/shared/types.ts` and `src/shared/parsers.ts`. Minimum for search: `{ id, title, price, rating, review_count, url }`. Minimum for detail: `{ packages, itinerary, sections }`. Keep the `cli({ site, name, ... })` registration block — just change `site` and `domain`.

3. **Build and register.**
   ```bash
   npm run build
   ln -sf "$PWD/dist/clis/viator" ~/.opencli/plugins/viator
   echo '{"name":"viator","version":"0.1.0","opencli":">=1.0.0"}' > dist/clis/viator/opencli-plugin.json
   opencli viator search "test" --limit 3     # smoke test
   ```

4. **Enable for AI comparison (no code change needed).** `src/compare/compare.ts` iterates whatever platforms the POI has configured — it doesn't have a hardcoded list. Just include the new platform when creating the POI:
   ```bash
   node dist/cli.js poi add "Mt Fuji" --keywords "Mt Fuji tour" --platforms klook,trip,viator
   ```

5. **(Optional) Web dashboard** — no work needed for the new platform to show up. The dashboard reads from the same POI config.

### Modifying an existing platform

Just edit `src/clis/<platform>/*.ts` and `npm run build`. Symlinks mean no re-registration. Verify with `opencli <platform> detail <id> -f json`.

### When the user asks Claude Code to extend

If the user asks "add platform X" or "the Klook detail is missing Y", you have everything you need:

- Source code of 4 working adapters to copy from
- `opencli doctor` to verify Browser Bridge is live
- `opencli <platform> search "..."` to test your changes
- `curl` and browser dev tools (via Browser Bridge) to reverse-engineer target sites

Iterate in the terminal: write adapter → build → run → read JSON output → fix → repeat. Expect the first draft of a new adapter to take 3–5 iterations against the real site.
