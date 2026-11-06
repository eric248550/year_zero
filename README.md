# Genesis Studio

Developer studio for **Genesis — Year Zero**, a persistent, AI-assisted,
post-apocalyptic civilization simulation. In 2089 a failed climate intervention
collapsed civilization; in 2131 twenty survivors open the blast door of Haven Deep
and start rebuilding.

This repository is the first vertical slice: a **deterministic simulation engine**,
a **storylet-based narrative engine**, an **AI event-draft pipeline** with human
review, **SQLite persistence with replay**, and a **mobile-first Next.js Studio** to
run, inspect and debug the world. The multiplayer RPG itself is out of scope.

> The simulation engine owns the truth. AI only proposes structured drafts; drafts
> are validated and must be approved and published by a developer. Nothing an LLM
> writes is ever executed as code.

## Quick start

Requirements: Node ≥ 20.10 (22 recommended), pnpm 10.

```bash
pnpm install
cp .env.example .env      # optional — defaults work without it
pnpm db:migrate           # create data/genesis.db
pnpm db:seed              # import 20 events + 3 storylines, create a demo run
pnpm dev                  # http://localhost:3000
```

To open it on a phone on the same network, run `pnpm dev:lan` and browse to
`http://<your-computer-ip>:3000`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Studio in development mode (port 3000) |
| `pnpm dev:lan` | Same, listening on all interfaces for phone testing |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm db:migrate` | Apply SQL migrations (also applied automatically when the Studio opens the DB) |
| `pnpm db:seed` | Import `content/` (idempotent) and create a demo run if none exists |
| `pnpm db:reset` | **Deletes** the local database, then migrates and seeds again |
| `pnpm test` | Vitest suite: determinism, invariants, replay, validation, persistence, AI pipeline |
| `pnpm typecheck` | Strict TypeScript over all packages and the Studio |
| `pnpm sim:run` | Batch simulation report (no DB, no LLM) |
| `pnpm content:validate` | Validate every file in `content/` and list warnings |
| `pnpm check` | typecheck + test + build |

`pnpm sim:run` options: `--seeds 50 --ticks 200 --start 1 --policy scholarly`,
`--all-policies`, `--json report.json`. It prints survival/collapse rate,
population, settlements, technology progress, crisis ticks, event frequency,
events that never fired, and invariant violations (non-zero exit if any).

## AI configuration

The Studio works fully without an AI key. Set these in `.env` to enable model
generation (server-side only; the key never reaches the browser):

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5     # default
GENESIS_AI_PROVIDER=                # "anthropic", or "mock" to disable the model
```

Without a key, **Content → Generate** offers a **deterministic mock generator**. Its
output is labelled `MOCK OUTPUT — produced by a deterministic template, not by an AI
model` in the UI and stored with `source: mock:template-generator-v1`. The Anthropic
provider uses the official SDK (streaming, `effort: medium`, server-side refusal
fallback enabled via `fallbacks: "default"`); remove those two fields in
`packages/ai/src/anthropic.ts` if you prefer not to use the fallback beta.

## The player app (`/play`)

The game itself, phone-first: open `http://localhost:3000/play` (or
`pnpm dev:lan` and the LAN address on a phone). Players join the **active run**.

- **Joining.** In year 0 everyone comes out of Haven Deep; surface-born,
  wanderer and Vault 12 origins unlock as the world develops. A three-step
  prologue gives instant results and introduces two people.
- **This year.** One yearly activity with an instant result (scavenge, work
  for the settlement, study, spend time with someone, rest; see
  `packages/simulation/src/systems/year-actions.ts`), decisions waiting for you (each participant decides for
  themselves and can change their mind until the year ends; unanswered ones
  are decided by your character's nature), your story, and news from home.
- **People.** Family, people you care for, bonds (grown through events and
  time spent together); invite a
  friend as your child, ward, close friend, or next child (`/play?invite=CODE`).
- **Death.** Continue as a child, ward or close friend, or be reborn at random.
- **Time.** Set `GENESIS_TICK_MINUTES` (e.g. `240` = 4 hours per world year
  for playtests, `1440` = one real day, `0.5` = 30 seconds for local
  testing). A progress bar under the header shows how far the year has run. The world advances lazily whenever
  someone opens the game; point a cron at `POST /api/play/clock` to keep it
  moving when nobody does. Unset = time only moves when the Studio steps it.
- **Identity.** Closed-playtest only: a random player id in an httpOnly
  cookie, no accounts. Player actions apply immediately and are logged in
  `immediate_actions`, so runs still replay and verify exactly.

Game content is written in Traditional Chinese (台灣繁體中文): the events and
storylines in `content/`, the World Bible, and the text the engine writes into
history. New worlds are `locale: "zh-TW"`; pass `locale: "en"` to `createRun`
for an English world. Worlds created before locales existed have no locale and
stay English, so they still replay exactly. The app's own text is in English
and Traditional Chinese.

## The Studio

Bottom navigation on mobile, sidebar on desktop. The UI is available in
**English and Traditional Chinese (繁體中文)**: use the language button in the
header (mobile) or sidebar (desktop). The choice is stored in a `genesis-locale`
cookie; without it, browsers that prefer Chinese get Chinese.

- **Overview** — year/tick, status and era, population, settlements, resources
  (with per-capita and last-tick deltas), population and resource charts, recent
  important events, technology/exploration/secret/storyline progress, and step
  controls.
- **Simulate** — create a world (seed + council policy), step 1 / 10 / run 100
  ticks (chunked, non-blocking, with progress and **Stop**), queue developer actions
  (research focus, policy, found settlement, expedition, caravan), load/archive runs,
  **verify replay**, **fork** from any past tick (optionally with a new policy or a
  reseeded random stream), **reset & replay** the same seed, snapshot list and
  decision log.
- **History** — the append-only timeline, filterable by year range, category,
  settlement, character, storyline, importance and source. Each event page shows
  the precondition trace with actual values, the deterministic roll, the decision
  and its alternatives (with availability reasons and policy scores), risk rolls,
  every state change (before → after), involved characters and settlements, and the
  causal chain (caused by / led to).
- **World** — settlements, people (search/filter), technology tree, flags with
  provenance, secrets, map. **Inspect any past tick**: the state is reconstructed
  from the nearest snapshot plus logged decisions. Character pages show age, birth
  year, profession, home, status, family, relationships and life events.
- **Content** — event definitions by status, a structured definition viewer, a
  JSON editor with live validation, validate → publish → archive workflow, version
  history, "could it fire right now?" analysis against the active run, per-run
  choice overrides, storylines with beat progress, the AI generator, and an AI log.
- **Compare** — two runs side by side: seed, policy, population, settlements,
  resources, technologies, secrets, overlay charts, technology and flag differences,
  storylets that fired differently, and milestone lists.

## Repository layout

```text
genesis/
├── apps/studio/            Next.js 15 App Router Studio (Tailwind v4, Recharts)
│   ├── app/                pages + route handlers (app/api/**)
│   ├── components/         UI primitives, charts, forms, content tools
│   └── lib/                server helpers (DB access, error mapping), formatting
├── packages/
│   ├── schemas/            shared kernel: Zod schemas, types, world catalog, RNG, hashing
│   ├── narrative/          conditions, roles, typed effects, storylet engine, validation
│   ├── simulation/         world factory, tick systems, council agent, metrics, invariants, replay
│   ├── ai/                 provider interface, Anthropic provider, mock provider, draft pipeline
│   └── database/           Drizzle schema + SQL migrations, run/content/history services
├── content/
│   ├── world-bible/        World Bible (lore, tone, author rules) — also sent to the AI
│   ├── events/             20 seed event definitions (JSON, one per file)
│   └── storylines/         3 storylines
├── scripts/                db:migrate, db:seed, db:reset, sim:run, content:validate
├── tests/                  Vitest suites
└── docs/ARCHITECTURE.md    design notes
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the engine, storylets,
replay and AI pipeline fit together.

## Status: what works and what does not (yet)

Working and covered by tests: deterministic seeded worlds; 12-phase tick pipeline
(production, consumption, shortages, wellbeing, aging/mortality, births, coming of
age, research with prerequisites, development, exploration, founding/abandonment,
storylets); typed effect pipeline with atomic rollback; append-only history
enforced by SQLite triggers; snapshots every 10 ticks; replay verification;
reconstruction of any past tick; forking; run comparison; content workflow; AI draft
pipeline (mock path).

Known limitations, stated plainly:

- **The live Anthropic call path was not exercised here** — no API key was
  available while building. It is typed against SDK 1.5 and its error handling is
  wired; the mock path and validation pipeline are tested.
- **Reset** archives the run and starts a new one with the same seed, policy and
  frozen content; it does not re-apply the old run's developer actions. Rewinding
  in place would violate immutable history.
- **Stop** takes effect between 10-tick chunks, not mid-chunk.
- **Forks** copy history up to the fork tick. There is no branch-tree visualisation,
  and verifying a fork's replay starts at the fork point.
- Event editing is JSON-with-live-validation, not a form builder. Storylines can be
  edited as JSON but not created from the UI (add a file in `content/storylines/`
  and run `pnpm db:seed`, or POST to `/api/content/storylines`).
- Publishing affects **new** runs only; existing runs keep their frozen content
  bundle so they stay replayable.
- Runs cannot be deleted (history is append-only); archive them instead, or
  `pnpm db:reset`.
- `ticksPerYear` exists in the state, but the economy and demography rates assume
  1 tick = 1 year.
- Single-process SQLite; no authentication (out of scope for this internal tool).
- **Language.** Game content and engine-written history are Traditional
  Chinese in new worlds; the Studio UI is English or Chinese. Engine validation
  messages (why an action was rejected) are still English, and character names
  are romanized.