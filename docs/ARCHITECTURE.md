# Architecture

## Principles

1. **The engine owns the truth.** World state changes only through
   `stepWorld` (rules) and the typed effect pipeline (narrative). No other code path,
   and certainly no LLM output, can mutate state.
2. **Deterministic and reproducible.** A run is fully defined by
   `(seed, rulesVersion, frozen content bundle, logged developer decisions)`.
3. **Framework-independent core.** `schemas`, `narrative` and `simulation` are pure
   TypeScript with no React, Next.js or database dependency, so a future game server
   can use them unchanged. Persistence is isolated in `database`.
4. **Observable.** Every historical event records why it happened (precondition
   trace, roll, priority), what was decided (choice, alternatives, scores, risk
   roll), what changed (before → after), and what caused it.

## Package dependency graph

```
schemas  ←  narrative  ←  simulation  ←  database  ←  apps/studio
                ↑                             ↑
                └──────────── ai ─────────────┘ (studio uses ai)
```

`schemas` is the shared kernel: Zod schemas and inferred types, the closed world
catalog (resources, professions, technologies, locations, secrets, policies), the
`Rng` (mulberry32) and canonical hashing. The catalog lives here because both the
narrative validator and the simulation rules must agree on the same vocabulary.

## Time

- `worldTick` (`state.tick`) is the only authoritative time. One tick = one year in
  this MVP; `year = startYear + tick`.
- Character age = `tick − birthTick` (frozen at `deathTick`). Never wall-clock.
- Developer execution time is measured separately (`tick_metrics.exec_ms`).
- The future server can call `stepWorld` on a schedule; the Studio calls it on demand.

## The tick (`packages/simulation/src/tick.ts`)

`stepWorld(state, { events, actions, choiceOverrides })` is pure: it clones the
input and returns `{ state, events, acceptedActions, rejectedActions,
rejectedEvents, metrics }`. Phases:

1. advance clock
2. developer actions — validated by `validateAction`, then applied (logged)
3. council agent — founding settlements under crowding, relief caravans
4. production → consumption (shortages open with a causal history event; stocks never go negative)
5. wellbeing (morale/health drift)
6. mortality (age curve × health × medicine; starvation/dehydration deaths link to the shortage event)
7. births → coming of age (profession by policy mix)
8. projects, development, exploration. Technologies are built, not researched:
   a project (`systems/projects.ts`) is started by the council (one per ~40 people,
   max 5, preferring untouched branches and early tiers) or by a player
   (`START_PROJECT`). Each year the settlement's people of the branch's profession
   work on it, joined players (`JOIN_PROJECT`, once) add more, knowledge is spent
   per unit of work, and setbacks/breakthroughs roll. Six branches × four tiers in
   `catalog.ts` (`BRANCHES`, `BRANCH_INFO`, `TECHNOLOGIES`).
   Conflict (`systems/conflict.ts`): pairwise settlement tension (`state.tensions`,
   0–100) drifts each year (`friction`: outpost burden, inequality, crowding,
   bunker vs surface; fades with radio, trade routes, the charter). ≥50 the
   council refuses aid; ≥60 the poorer side may raid (`raids`). Crowded or
   unhappy settlements of 40+ can split (`schisms`). Content reads it through the
   `tension` condition, changes it with `CHANGE_TENSION`, and names the other side
   `{{rival}}` (the settlement it is most at odds with).
   Decisions: `participation: "everyone"` events either let each group act
   (`resolution: "each"`, default) or hold one vote (`resolution: "vote"`): all
   answers are collected, tallied once (players count 1 + `VOTE_PERSUASION`), and
   only the winner's effects run. Validation rejects "each" events whose choices
   change world flags. Goods move between settlements with `EXCHANGE` (capped by
   what the other side has); projects change with `CHANGE_PROJECT`; projects have
   an `approach` (steady/careful/bold/frugal) chosen by their lead; players can
   only START projects in their own profession's branches.
9. narrative phase (storylets)
10. abandonment, collapse and milestones

The RNG state is stored in `WorldState.rng`, so a snapshot fully captures the random
stream. Tunable constants live next to each system (`ECONOMY`, `DEMOGRAPHY`).

## Storylets (`packages/narrative`)

Three separate things:

| Concept | Where | Mutable? |
| --- | --- | --- |
| Event definition — what *may* happen | `event_definitions` (+ `content/events`) | Versioned; draft → validated → published → archived |
| Storyline — a group of related possibilities | `storylines` | Editable; beats are not a script |
| Historical event — what *did* happen | `history_events` | Append-only (DB triggers) |

Each tick, published definitions are sorted by priority. For each one,
`checkEligibility` evaluates status, max occurrences, cooldown, then for every
anchor (each active settlement, or the world) the preconditions, whether required
roles can be filled by distinct **living** characters, and whether at least one
choice is available (costs affordable, requirements met, required roles fillable).
An eligible event fires if `rng < chance` (max 3 per tick).

`executeEvent` resolves roles, picks a choice (developer override, else a
policy-weighted roll over choice tags), then runs everything inside `transact` on a
deep copy: base effects → choice costs (`spendResources` fails if unaffordable) →
choice effects → optional risk roll. Any `EffectError` rolls the whole event back
and records a rejection.

Typed effects: `ADJUST_RESOURCE`, `CHANGE_RELATIONSHIP`, `DISCOVER_LOCATION`,
`UNLOCK_TECHNOLOGY` (prerequisites enforced), `CHANGE_SETTLEMENT_STAT`,
`ADD_WORLD_FLAG` / `REMOVE_WORLD_FLAG` (reserved `secret.`/`system.` namespaces
rejected), `CREATE_HISTORICAL_EVENT` (appends a linked child record — there is no
edit/delete effect), `REVEAL_SECRET` (the only way a secret becomes known),
`ADD_LIFE_EVENT`, `CHARACTER_DEATH`. Unknown types are rejected both by validation
and at runtime.

**Provenance.** `flagOrigins`, `eventMemory.lastHistoryId`, `secrets[].historyId`
and `settlement.shortageOrigin` map state back to the history event that produced
it, so satisfied preconditions yield `causeIds`.

## Validation (`validateEventDefinition`)

1. A pre-pass reports unsupported effect types with a clear message.
2. Zod (strict objects, discriminated unions, ranges).
3. Rules: unknown technologies/locations/secrets/storylines/roles; scope mismatches
   (settlement effects or conditions in world-scoped events); contradictory or
   impossible preconditions (interval analysis per metric, boolean conflicts, tech
   required while its prerequisite is forbidden, one-shot events requiring
   themselves); reserved flags; duplicate roles/choices; warnings for unguarded
   tech unlocks, lethal effects, large swings, pacing, unknown template placeholders.

The same pure validator runs in the browser (live editor feedback) and on the server.

## AI pipeline (`packages/ai`)

```
prompt → context (World Bible, catalog, JSON Schema, allowed effects)
       → provider.generate()          (Anthropic or Mock; server-side)
       → JSON extraction
       → status forced to "draft", provenance in `source`
       → Zod + rule validation
       → developer preview → approve (stored as draft) | reject
       → validate → publish (separate explicit steps)
```

`EventDraftProvider` is the replaceable interface. Every attempt is logged in
`ai_generations` with provider, model, `is_mock`, raw output and outcome. The mock
is never substituted for a failed model call: errors are surfaced.

## Persistence & replay (`packages/database`)

Tables: `runs` (head state + hash, queued actions, choice overrides), `run_content`
(frozen bundle), `snapshots` (every 10 ticks + tick 0 + fork points), `history_events`
(append-only), `decisions` (append-only; accepted actions and overrides per tick),
`tick_metrics`, `event_definitions` + `event_definition_versions` (append-only),
`storylines`, `ai_generations`, `settings`.

`stepRun` commits a whole batch atomically. `reconstructState(run, tick)` loads the
nearest snapshot ≤ tick and replays logged decisions with the frozen content — no
LLM calls. `verifyReplay` replays the run and compares every snapshot hash and the
head hash. `forkRun` copies history/metrics/decisions/snapshots up to the fork tick
and optionally changes policy or reseeds the RNG.

Migrating to Postgres: the services use Drizzle query builders and JSON columns;
the SQLite-specific parts are `json_each` filters in `services/history.ts` and the
triggers in `migrations/0001_immutability.sql`.

## Testing

`tests/` covers determinism, invariants across seeds and policies (stress),
resources, aging and death, event preconditions and roles, the effect pipeline,
validation, immutable history, snapshots and replay, persistence (including the
DB-level immutability triggers, reset and fork), and the AI pipeline.
`pnpm sim:run` is the balance and regression harness.

## Players (`packages/simulation/src/systems/players.ts`, `packages/narrative/src/decisions.ts`)

The world is multiplayer: each player controls at most one living character
(`Character.controllerId`); everyone else is an NPC run by the simulation.
Player state lives in optional `WorldState.players`, `pendingDecisions` and
`invites`, so worlds that never had a player keep their exact previous shape
and replay hashes.

- **Joining** (`JOIN_WORLD`). `availableOrigins(state)` lists where a new
  character can come from. Year 0 offers only Haven Deep (take over a free
  founder or arrive as a new resident; population is not capped). Surface-born
  opens once a surface settlement has stood a year, wanderers from year 8,
  Vault 12 survivors once someone opens Vault 12.
- **Everyone decides for themselves.** When an event fires and a participant
  is player-controlled, the engine applies the base effects, records the event
  and opens a `PendingDecision` instead of letting the council choose.
  Participants are the role holders (`participation: "roles"`, default) or
  every resident aged 12+ (`participation: "everyone"`). Players answer with
  `CHOOSE` before the next tick; whoever does not answer is decided for by
  autopilot (policy weights × personality traits). At resolution participants
  are grouped by choice: the choice's `effects` run once per group,
  `memberEffects` and risk once per member (role `actor`), and risk chance is
  divided by √(group size). Events with no player participants behave exactly
  as before.
- **Death and succession** (`CONTINUE_AS`). A dead character's player waits in
  `awaiting_succession` and may continue as a free child, ward (`CARE_FOR`
  sets `caretakerIds`) or close companion (relationship ≥ 50) of their last
  character, or be reborn at random as a free child aged 6–15 (a newborn if
  none exists).
- **Invites** (`INVITE` + `JOIN_WORLD { inviteCode }`). A player reserves a free
  child, ward or companion for a friend, or invites them as their next child
  (assigned when born to the inviter). Unused invites expire after 7 ticks.
- The council never relocates a player's character when founding settlements.
- `LEAVE_WORLD` hands the character back to the simulation.

## Attributes and bonds

Worlds created now have `attributesEnabled`; every character has `attributes`
(health, social, knowledge, survival, 0–100), rolled from profession and nature
(`systems/attributes.ts`). They drift yearly without randomness (health follows
the settlement and age, children learn, work trains its skills) and they matter:
health scales personal mortality, survival scales personal risk in decisions,
social scales positive relationship changes, and roles can require
`minAttributes`. Older worlds get them through the logged `ENABLE_ATTRIBUTES`
developer action.

Bonds grow through events, not buttons. Personal scenes (`content/events/` with
`tags: ["personal"]`) use a `player: true` role so they only fall on players, an
`orphan` role filter, `familiarWith` to prefer people the player already has
history with, and two effects: `ADJUST_ATTRIBUTE` and `ADD_CARETAKER` (which is
how someone becomes a ward and a succession candidate).

### Personal events

Worlds created now also have `personalEvents`. Any event with a `player: true`
role is then left out of the world-wide narrative phase and scheduled per
player instead (`runPersonalPhase` in `packages/narrative/src/engine.ts`): each
year, in player-id order, every player who has finished the prologue gets one
event with chance 0.85 and a second with chance 0.25, picked from the events
that fit them, using each event's `chance` as its relative weight. Cooldowns
and `maxOccurrences` count per player (`player.personal`), and nobody gets
more than two open decisions at once. In the same worlds, world events cast
players `PLAYER_ROLE_WEIGHT` (10) times as often as NPCs. With the current
content a player meets about one personal event a year, and goes at most two
years without one. Older worlds skip both rules, so their replays are unchanged.

Worlds created now also have `instantDecisions`: when a CHOOSE completes a
decision (every living participant has answered, which for a personal event
means just the player), `applyImmediate` resolves it on the spot and the app
shows the outcome at once. Group decisions with NPC participants still wait
for the year to end. `applyImmediate` takes the run's frozen content for this,
and replay passes it too.

And `sharedScenes`: a personal event is decided only by the player it is
about (the `player: true` role); other players cast in it are weighted
`PLAYER_ROLE_WEIGHT` (10) times higher in `familiarWith` picks and see it in their
"new" inbox (`inboxFor` in `apps/studio/lib/play.ts`). Players can meet up to
three personal events a year (chances 0.9 / 0.6 / 0.3); the app shows each at
a fixed point 5–65% through the year and refreshes every 15 seconds. With
three players, about 1.7 personal events per player-year, a third of them
with another player in them.
