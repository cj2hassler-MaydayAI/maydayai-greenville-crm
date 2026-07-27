# Scout — ingredient transparency

A mobile-first web app that tells you, at a glance, whether a nearby restaurant,
fast-food chain, or grocery product contains ingredients you've chosen to avoid —
and, critically, **what to order or buy instead**.

The substitution engine is the product. The map is the wrapper.

## Setup

```bash
cd scout
npm install
cp .env.example .env.local     # every value is optional; see below
npm run db:seed                # loads the curated chain data, creates ./scout.db
npm run dev                    # http://localhost:3000
```

Requires Node 20+. There is no database server to install: SQLite is a file.

```bash
npm test          # 53 tests: matcher, substitution guards, full data path
npm run build     # production build
```

## Environment

Everything is optional. **Scout is useful with an empty database, no API key, and
no accounts** — the barcode scanner, venue search, ingredient matching, and seed
data all work without any of it.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Only used by the menu substitution engine. Put it in `.env.local` for local dev, or your host's secret store in production. Without it that feature degrades to matcher-only output rather than failing. |
| `SCOUT_MODEL` | Defaults to `claude-sonnet-5`. |
| `SCOUT_DB_PATH` | Defaults to `./scout.db`. |
| `SCOUT_USER_AGENT` | **Set this before deploying.** See rate-limit etiquette below. |
| `SCOUT_NOMINATIM_BASE`, `SCOUT_OVERPASS_URL`, `SCOUT_OFF_BASE` | Point at your own mirrors. See below. |
| `SCOUT_ENABLE_MODERATION` | Set to `1` to expose `/api/moderation`. Off in production by default — read the warning in that file first. |

`.env.local` is gitignored. Never commit a key.

## Free data sources, and being a good citizen about them

Scout has zero paid third-party dependencies. That only stays true if we don't
abuse the volunteer-run services it relies on.

**OpenStreetMap (Nominatim + Overpass)** — used for geocoding and finding nearby
venues. Their usage policies require a **descriptive `User-Agent`** identifying
your deployment, and roughly **one request per second maximum**. Both are enforced
in `lib/http-cache.ts`, which is the only module permitted to call them:

- a per-host queue serializes requests and spaces them ≥1100 ms apart
- every response is cached in SQLite for **30 days**; cache hits consume no quota
- Overpass cache keys round coordinates to ~1 km so nearby users share entries
- **these endpoints are never called from the browser**

Before you deploy, set `SCOUT_USER_AGENT` to something that identifies you and
includes a contact address. A generic or missing User-Agent will get you blocked.
If you expect real traffic, run your own [Nominatim](https://nominatim.org/) and
[Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API/Installation)
instances and point `SCOUT_NOMINATIM_BASE` / `SCOUT_OVERPASS_URL` at them.

**Attribution is a licence condition, not a courtesy.** Any screen showing OSM
data must credit `© OpenStreetMap contributors`; the nearby list and the map
tile layer both do. Open Food Facts data is ODbL and is credited on the scan
screen.

**Open Food Facts** — free, no key, no published rate limit, so it is not
throttled; responses are still cached for 30 days.

**USDA FoodData Central** is noted in the spec as a nutrition fallback for when
Open Food Facts has no record. It is **not wired up** — Open Food Facts covers
the ingredient-list use case, and USDA's branded data would not have changed any
verdict. `lib/openfoodfacts.ts` is where a fallback would slot in.

## Deploying (and the SQLite → Postgres note)

Scout targets Vercel, but **SQLite does not work on serverless**: the filesystem
is ephemeral and read-only, so every invocation would get an empty database.

Swapping the store is deliberately a one-file change. `lib/db/client.ts` is the
only file that imports `better-sqlite3`; everything else talks to the exported
Drizzle `db`, and every query lives in `lib/db/repository.ts`. To move to
Postgres or Turso:

1. Rewrite the body of `lib/db/client.ts`:
   ```ts
   import { drizzle } from 'drizzle-orm/postgres-js';
   import postgres from 'postgres';
   export const db = drizzle(postgres(process.env.DATABASE_URL!), { schema });
   ```
2. Change `dialect` in `drizzle.config.ts` and run `npx drizzle-kit push`
   (the `CREATE TABLE IF NOT EXISTS` bootstrap in `client.ts` exists so a fresh
   local checkout runs without a migration step — drop it).
3. Remove `better-sqlite3` from `serverExternalPackages` in `next.config.ts`.

The schema is already written for this: no SQLite-only column types, arrays
stored as JSON, timestamps as ISO strings, text ids.

## How a verdict is decided

Three states, never two:

| Verdict | Means |
| --- | --- |
| **FLAGGED** | At least one enabled category matched. The exact matched text is always shown. |
| **VERIFIED CLEAN** | We inspected enough real ingredient data to say so: ≥3 items with ingredient text, none below 0.6 confidence, zero matches. |
| **NO DATA** | Anything thinner than that. This is a common and honest answer. |

A venue is scored **only against the categories that user enabled** — someone
avoiding seed oils but fine with Impossible burgers gets a pass on the latter.

Matching normalizes to lowercase, strips punctuation, then matches on word
boundaries, so `corn` never satisfies the `corn oil` keyword. The matcher returns
the offsets of every match so the UI can quote the source text verbatim. **Nothing
is ever flagged without the evidence being displayable.**

The strictness setting: *strict* flags any appearance including "may contain"
traces; *relaxed* flags only primary ingredients, ignoring anything after a
"contains 2% or less" marker.

## The substitution engine

When a venue has menu data, `POST /api/venues/[id]/analyze` sends the menu and
the user's enabled categories to Claude and asks for structured JSON only.

The prompt tells the model to answer "unknown" rather than guess — but a prompt
is not an enforcement mechanism, so `sanitize()` in `lib/substitution.ts` drops,
after the fact:

- any `avoid` entry whose `matched` string does not literally occur in the menu
  text we supplied
- any `avoid` entry for a category the user did not enable
- any recommendation naming an item that is not on the menu

Results are cached permanently on `(venue_id, sorted_enabled_categories, menu_hash)`.
The same combination never costs a second API call.

## Crowdsourced reports

One tap from a venue: pick a category, optionally name the item and add a note.
Reports display as "reported by users", visually distinct from verified data, and
are **never merged into it**. Simple up/down voting, one vote per anonymous token:
net −3 hides a report, net +5 promotes it to `confirmed`, and only a confirmed
report affects a venue's verdict. Rate limited to 10 reports/day per token.

`/api/moderation` is a **stub** and is disabled in production by default. Read the
comment at the top of that file before enabling it — crowdsourced ingredient
claims about named businesses carry real legal risk, and it currently has no
authentication, no takedown actions, and no audit trail.

## Data honesty

`data/seed-chains.json` covers ~50 major US chains. Every item carries a `source`,
a `verifiedAt` date, and a `confidence`. Entries marked `confidence: "low"` are
**unverified** — usually the industry-default assumption that commercial fryers
run a vegetable-oil blend. Low-confidence records map to 0.35, which is below the
0.6 floor in `computeVerdict`, so **an unverified record can flag a venue but can
never earn it a "verified clean"**.

Most chains in the file deliberately carry **no** menu items and read "NO DATA".
A thin honest dataset beats a thick fabricated one.

Ingredient formulations change constantly and vary by franchise location. The app
says so once, on the venue screen, where it matters — not as a nagging banner on
every page.

## Accounts and privacy

There are none. No accounts, no email, no auth in v1. Preferences are stored
against an opaque random token in an httpOnly cookie.

## Design

A field reference tool, closer to transit signage than to a lifestyle brand: read
at a glance, at arm's length, in bad light.

Palette: slate `#2B3440`, bone `#EDEAE3`, verified `#0F8B4C`, unknown `#8A8F98`,
flagged `#C6303A`. The three signal colours are used **only** for verdicts, never
decoratively. Type: Archivo Narrow for verdicts and venue names, Inter for body,
IBM Plex Mono for ingredient strings — ingredient text should look like data,
because that is what earns trust. The verdict renders as a slightly rotated
rubber-stamp badge; that is where the boldness is spent and everything else stays
quiet.

Fonts load from Google Fonts with a system fallback stack, so the app degrades
cleanly if that request is blocked. Self-host them if you'd rather not depend on
it. `prefers-reduced-motion` is respected, keyboard focus is visible (3px outline),
and every screen is verified to work at 375px with no horizontal overflow.

## Layout

```
app/            screens + route handlers
components/     UI; VerdictStamp and IngredientText carry the honesty rules
lib/flags.ts    the flag taxonomy — the core IP
lib/matcher.ts  normalization, word-boundary matching, verdict computation
lib/substitution.ts   Claude prompt + the anti-fabrication guard
lib/http-cache.ts     rate limiting + 30-day cache for the OSM endpoints
lib/db/client.ts      the storage swap point
lib/db/repository.ts  every query in the app
data/           seed-chains.json (hand-curated), seed-flags.json (generated)
```
