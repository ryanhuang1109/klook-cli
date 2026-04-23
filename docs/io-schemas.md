# I/O Schemas & Database Insertion

Defines the exact **input arguments**, **output JSON shape**, and **database table mapping** for every opencli / tours command. This is the reference each skill points to so outputs can be inserted into Supabase (or the current SQLite mirror) without guessing.

Status: **schema current (SQLite); Supabase migration pending.** Schema in `src/tours/db.ts` is Postgres-compatible except `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`.

---

## 1. Data flow

```
┌───────────────┐  1. scrape   ┌───────────────┐  2. normalize  ┌───────────────┐
│ Platform CLI  │─────────────▶│  Raw JSON     │───────────────▶│ Canonical     │
│ get-activity  │              │  (per-command │                │ types (Zod)   │
│ get-packages  │              │   shape,      │                │ in            │
│ get-pricing…  │              │   section 3)  │                │ src/shared/   │
└───────────────┘              └───────────────┘                └───────┬───────┘
                                                                         │
                                               3. insert (tours pipeline)│
                                                                         ▼
                          ┌───────────────────────────────────────────────────────┐
                          │ tables:  activities → packages → skus → sku_obs…       │
                          │ supporting: run_sessions, execution_logs,              │
                          │             search_runs                                 │
                          └───────────────────────────────────────────────────────┘
```

A skill's job:
1. Invoke the CLI command with documented input args.
2. Receive JSON matching the documented output shape.
3. (When running inside `tours ingest-pricing` / `ingest-from-detail`) the tours module normalizes + persists automatically.
4. For **ad-hoc** use (skills running outside tours pipeline), use the field mapping in section 4 to INSERT into the right table(s).

---

## 2. Canonical DB schema (SQLite now, Supabase-ready)

### `activities` — one per (platform, platform_product_id)

| Column | Type | Nullable | Notes |
|---|---|:-:|---|
| `id` | TEXT PK | no | internal UUID or `{platform}:{platform_product_id}` |
| `platform` | TEXT | no | `klook` / `trip` / `getyourguide` / `kkday` |
| `platform_product_id` | TEXT | no | external ID (numeric string) |
| `canonical_url` | TEXT UNIQUE | no | |
| `title` | TEXT | no | |
| `supplier` | TEXT | yes | |
| `poi` | TEXT | yes | POI label (e.g. "Mount Fuji") |
| `duration_minutes` | INTEGER | yes | |
| `departure_city` | TEXT | yes | |
| `rating` | REAL | yes | |
| `review_count` | INTEGER | yes | |
| `order_count` | INTEGER | yes | booking count (KKday "travelers booked") |
| `description` | TEXT | yes | |
| `raw_extras_json` | TEXT | no, default `{}` | JSON blob for platform-specific extras (images, sections, itinerary) |
| `first_scraped_at` | TEXT (ISO) | no | |
| `last_scraped_at` | TEXT (ISO) | no | |
| `review_status` | TEXT | no, default `unverified` | `unverified` / `verified` / `flagged` / `rejected` |
| `review_note` | TEXT | yes | |

### `packages` — per activity-variant (language / group-size / tier)

| Column | Type | Nullable | Notes |
|---|---|:-:|---|
| `id` | TEXT PK | no | |
| `activity_id` | TEXT FK→activities.id | no | |
| `platform_package_id` | TEXT | yes | |
| `title` | TEXT | no | |
| `tour_type` | TEXT | no | normalized (e.g. `day-tour`, `ticket`) |
| `available_languages` | TEXT | no | JSON array as string |
| `group_size` | TEXT | no | `private` / `shared` / `unknown` |
| `meals` | INTEGER (0/1) | yes | |
| `departure_city` | TEXT | yes | |
| `departure_time` | TEXT | yes | |
| `duration_minutes` | INTEGER | yes | |
| `inclusions` | TEXT | no, default `[]` | JSON array |
| `exclusions` | TEXT | no, default `[]` | JSON array |
| `completeness_json` | TEXT | no, default `{}` | which fields were filled by normalizer |

### `skus` — per (package × travel_date)

| Column | Type | Nullable | Notes |
|---|---|:-:|---|
| `id` | TEXT PK | no | |
| `package_id` | TEXT FK→packages.id | no | |
| `travel_date` | TEXT | no | ISO date |
| `price_local` | REAL | yes | in platform's native currency |
| `price_usd` | REAL | yes | normalized, optional |
| `currency` | TEXT | yes | ISO currency code |
| `available` | INTEGER (0/1) | no, default 1 | |
| `last_checked_at` | TEXT | no | |
| `review_status` | TEXT | no, default `unverified` | |
| `review_note` | TEXT | yes | |

### `sku_observations` — append-only price history

| Column | Type | Nullable | Notes |
|---|---|:-:|---|
| `id` | INTEGER PK AUTOINCREMENT | no | Supabase: use `GENERATED ALWAYS AS IDENTITY` |
| `sku_id` | TEXT FK→skus.id | no | |
| `checked_at` | TEXT (ISO) | no | |
| `price_local` | REAL | yes | |
| `price_usd` | REAL | yes | |
| `available` | INTEGER | no | |

### Supporting tables

- `run_sessions` — a `tours run-daily-routine` session (destination, keyword, poi, competitors, status, timestamps)
- `execution_logs` — per-activity attempt log (strategy, duration, success, errors, packages/skus written)
- `search_runs` — per (platform, keyword) search result metrics

See `src/tours/db.ts` for the full DDL.

---

## 3. Per-command I/O shapes

### 3.1 `opencli <p> search-activities "<query>"`

**Input**:
| arg | type | required | notes |
|---|---|:-:|---|
| `query` (positional) | string | yes | keyword phrase |
| `--limit <N>` | number | no | default varies by platform |
| `-f json` | flag | — | required if parsing |

**Output** — array, each element:
```ts
{
  rank: number,
  id: string,               // platform_product_id
  title: string,
  price: string,            // raw text, e.g. "HK$ 520"
  currency: string,         // often "" — parse from `price` if needed
  rating: string,           // e.g. "4.8"
  review_count: string,     // e.g. "29.2K+ reviews"
  category: string,
  city: string,
  url: string,              // canonical URL
}
```

**DB mapping**: not persisted directly. Consumed by `tours ingest-top-from-search` to derive (platform, platform_product_id) targets → triggers `get-activity` / `get-pricing-matrix`.

### 3.2 `opencli <p> get-activity <id>`

**Input**:
| arg | type | required | notes |
|---|---|:-:|---|
| `activity` (positional) | string | yes | ID or full URL |
| `--date <YYYY-MM-DD>` | string | no | focus pricing on a date |
| `--compare-dates` | flag | no | **Trip only** — emit 7-day inline prices |

**Output**:
```ts
{
  title: string,
  description: string,
  city: string,
  category: string,
  rating: string,
  review_count: string,
  order_count?: string,     // KKday booking counter
  supplier?: string,        // Klook
  images: string[],
  itinerary: Array<{ time: string, title: string, description: string }>,
  packages: Package[],      // see 3.3 output
  sections: Array<{ title: string, original_title: string, content: string }>,
  url: string,
}
```

**DB mapping**:
- `title`, `description`, `rating` (parse to REAL), `review_count` (parse "29.2K+" → 29200), `order_count`, `supplier` → `activities.*`
- `images`, `sections`, `itinerary` → `activities.raw_extras_json` (JSON blob)
- `packages[]` → iterate, INSERT into `packages` + derived `skus` — see 3.3

### 3.3 `opencli <p> get-packages <id>`  *(new, narrow projection)*

**Input**: same as `get-activity`.

**Output**:
```ts
{
  activity_id: string,
  url: string,
  packages: Array<{
    name: string,
    description: string,
    inclusions: string[],
    exclusions: string[],
    price: string,          // raw text with currency symbol
    currency: string,
    original_price: string, // "" if no strikethrough
    discount: string,       // "" if no promo
    date: string,           // "" if no specific date pinned
    availability: string,   // "Available" / "Sold out" / ""
  }>,
}
```

**DB mapping**:
- Each `packages[i]` → INSERT row in `packages` table (derive `id`, `platform_package_id`, `tour_type` via normalizer)
- If `price` is set, also derive SKU: INSERT into `skus` with `travel_date = date || today`, `price_local = parseFloat(price)`, `currency = ...`
- `inclusions` / `exclusions` → stored as JSON strings
- Remaining detail fields (`title`, `description`, etc.) are NOT returned — so `get-packages` alone is insufficient to populate `activities`. Always combine with a prior `get-activity` or `search-activities` to get the parent row's fields.

### 3.4 `opencli <p> get-pricing-matrix <id> --days <N>`

**Input**:
| arg | type | required | notes |
|---|---|:-:|---|
| `activity` | string | yes | ID or URL |
| `--days <N>` | number | no | default 7 |

**Output**:
```ts
{
  activity_id: string,
  url: string,
  platform: string,
  packages: Array<{
    package_id: string,     // platform_package_id (SKU tab id on Trip, option id on KKday…)
    name: string,
    prices: Array<{
      date: string,         // ISO YYYY-MM-DD
      price: string,        // raw text with currency
      currency: string,
      available: boolean,
    }>,
  }>,
  scraped_at: string,       // ISO timestamp
}
```

**DB mapping** — this is the **primary feed** for the pipeline:
- For each `packages[i]`: upsert `packages` row keyed by `(activity_id, platform_package_id)`
- For each `packages[i].prices[j]`: upsert `skus` row keyed by `(package_id, travel_date)`, update `price_local`, `currency`, `available`, `last_checked_at`
- Append one row per `(sku_id, checked_at)` to `sku_observations` for history

### 3.5 `opencli klook list-trending "<city>"`  *(Klook only)*

**Input**: `city` (positional), `-f json`.

**Output** — array of `{ rank, title, url, rating, review_count, image }`.

**DB mapping**: not persisted. Used as a discovery feed for `ingest-top-from-search`.

---

## 4. Scraped field → DB column mapping (cheat-sheet)

| Scraped field | Target table.column | Transform |
|---|---|---|
| `title` | `activities.title` | trim, `.slice(0,500)` |
| `description` | `activities.description` | trim |
| `rating` ("4.8") | `activities.rating` | parseFloat |
| `review_count` ("29.2K+") | `activities.review_count` | parse K/M/comma → integer |
| `order_count` ("15,000+ booked") | `activities.order_count` | extract digits |
| `supplier` | `activities.supplier` | strip leading `:`, trim |
| `images[]`, `sections[]`, `itinerary[]` | `activities.raw_extras_json` | stringify whole array |
| `url` | `activities.canonical_url` | strip query params |
| `packages[].name` | `packages.title` | |
| `packages[].inclusions[]` | `packages.inclusions` | JSON.stringify |
| `packages[].exclusions[]` | `packages.exclusions` | JSON.stringify |
| `packages[].description` | derive `packages.tour_type` | normalize heuristics in `src/tours/normalize.ts` |
| `packages[].price` + `.currency` | `skus.price_local`, `skus.currency` | parse numeric, ISO currency |
| `packages[].date` or target_date | `skus.travel_date` | ISO YYYY-MM-DD |
| `packages[].availability` | `skus.available` | `Available` → 1, `Sold out` → 0 |

Normalizer (`src/tours/normalize.ts`) owns the numeric parsing (K/M suffixes, currency code extraction, date normalization) — skills should NOT duplicate that logic inline.

---

## 5. Supabase-specific notes

To migrate the current SQLite schema to Supabase:

1. `sku_observations.id INTEGER PRIMARY KEY AUTOINCREMENT` → `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`.
2. `execution_logs.id` and `search_runs.id` — same treatment.
3. All `TEXT` columns storing ISO timestamps (`first_scraped_at`, `last_scraped_at`, `checked_at`, etc.) should migrate to `TIMESTAMPTZ` with explicit parsing during insert.
4. JSON-as-TEXT columns (`raw_extras_json`, `inclusions`, `exclusions`, `completeness_json`, `available_languages`) should become `JSONB` for indexable queries.
5. Add RLS policies — minimum: `service_role` full access; `authenticated` read-only on `activities` / `packages` / `skus` for the web dashboard.
6. Create indexes matching the current SQLite indexes (`idx_obs_sku ON sku_observations(sku_id, checked_at)` → `CREATE INDEX ON public.sku_observations (sku_id, checked_at);`).

A ready-to-run migration file belongs in `supabase/migrations/0001_initial.sql` when the project is provisioned.

---

## 6. Where each skill declares its schema

Platform skills (`opencli-klook`, `opencli-trip`, `opencli-getyourguide`, `opencli-kkday`) should each append an **I/O Schema** section that:

1. Lists the exact input args for each of the four commands (search-activities / get-activity / get-packages / get-pricing-matrix).
2. Shows the platform-specific nuances in output (e.g. GYG language axis, KKday booking counter, Trip `--compare-dates` field).
3. References this document for the canonical shape.

Cross-platform skills (`opencli-tours-routine`, `opencli-compare-poi`) should reference the DB tables they read/write from, **not** re-document the CLI output shape.

The router skill (`opencli-router`) doesn't need a schema section — it dispatches, doesn't consume.
