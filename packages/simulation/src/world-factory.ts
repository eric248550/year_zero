import {
  ADULT_AGE,
  BRANCH_INFO,
  LOCATIONS,
  SPECIALTIES,
  SPECIALTY_INFO,
  PROFESSIONS,
  RULES_VERSION,
  Rng,
  START_YEAR,
  seedToState,
  type Character,
  type PolicyId,
  type Profession,
  type WorldLocale,
  type WorldState,
} from "@genesis/schemas";
import { placeName, professionName, say } from "@genesis/narrative";
import { rollAttributes } from "./systems/attributes";
import { FAMILY_NAMES, GIVEN_NAMES, TRAITS, ZH_FAMILY_NAMES, ZH_GIVEN_NAMES } from "./names";

export interface CreateWorldOptions {
  seed: number;
  /** Language of engine-generated text. Default zh-TW; "en" for English worlds. */
  locale?: WorldLocale;
  policy?: PolicyId;
  worldName?: string;
  survivors?: number;
}

export function newCharacterId(state: WorldState): string {
  const id = `c${String(state.counters.nextCharacter).padStart(4, "0")}`;
  state.counters.nextCharacter += 1;
  return id;
}

/** A default name in the world's language. Children keep their parent's family name. */
export function randomName(rng: Rng, family?: string, locale?: WorldLocale): { givenName: string; familyName: string } {
  const zh = locale === "zh-TW";
  return { givenName: rng.pick(zh ? ZH_GIVEN_NAMES : GIVEN_NAMES), familyName: family ?? rng.pick(zh ? ZH_FAMILY_NAMES : FAMILY_NAMES) };
}

/**
 * Create the seeded starting world: Haven Deep bunker, two known surface sites,
 * hidden locations to discover, and ~120 survivors of every age. Fully deterministic per seed.
 */
export function createWorld(options: CreateWorldOptions): WorldState {
  const rng = new Rng(seedToState(options.seed));
  const survivors = options.survivors ?? 120;

  const locale: WorldLocale = options.locale ?? "zh-TW";
  const t = say({ locale });
  const state: WorldState = {
    schemaVersion: 1,
    locale,
    rulesVersion: RULES_VERSION,
    worldName: options.worldName ?? "Year Zero",
    seed: options.seed,
    tick: 0,
    ticksPerYear: 1,
    startYear: START_YEAR,
    rng: 0,
    policy: options.policy ?? "balanced",
    researchFocus: null,
    settlements: [
      {
        id: "s-haven",
        name: placeName({ locale }, "haven_deep"),
        locationId: "haven_deep",
        kind: "bunker",
        status: "active",
        foundedTick: 0,
        abandonedTick: null,
        level: 2,
        morale: rng.int(50, 62),
        health: rng.int(64, 74),
        capacity: 170,
        resources: {
          food: rng.int(200, 240),
          water: rng.int(200, 240),
          materials: rng.int(110, 140),
          knowledge: rng.int(30, 45),
        },
        shortage: { food: 0, water: 0 },
        shortageOrigin: { food: null, water: null },
      },
    ],
    locations: LOCATIONS.map((l) => ({
      id: l.id,
      discovered: l.initiallyKnown,
      discoveredTick: l.initiallyKnown ? 0 : null,
      settlementId: l.id === "haven_deep" ? "s-haven" : null,
    })),
    characters: [],
    technologies: [],
    techUnlockedAt: {},
    flags: { "world.surface_open": true },
    flagOrigins: {},
    secrets: {},
    relationships: {},
    eventMemory: { lastFiredTick: {}, counts: {}, lastHistoryId: {} },
    counters: { nextCharacter: 1, nextHistory: 1, nextSettlement: 1 },
    milestones: [],
    stats: { births: 0, deaths: 0, peakPopulation: 0 },
  };

  // A bunker that has lived sealed for 40 years: about a fifth children, a tenth elders.
  const children = Math.max(0, Math.round(survivors * 0.2));
  const elders = Math.round(survivors * 0.1);
  const adults = survivors - children;
  // Guarantee every profession is represented, then fill randomly.
  const professions: Profession[] = [...PROFESSIONS];
  while (professions.length < adults) professions.push(rng.pick(PROFESSIONS));
  const shuffled = rng.shuffle(professions);

  const adultsList: Character[] = [];
  for (let i = 0; i < adults; i++) {
    const age = i < elders ? rng.int(65, 82) : rng.int(18, 60);
    const c: Character = {
      id: newCharacterId(state),
      ...randomName(rng, undefined, locale),
      birthTick: -age,
      deathTick: null,
      causeOfDeath: null,
      profession: shuffled[i] ?? "Engineer",
      homeId: "s-haven",
      parentIds: [],
      traits: [rng.pick(TRAITS)],
      lifeEvents: [{ tick: -age, text: t.bornHaven(), historyId: null }],
    };
    c.lifeEvents.push({ tick: 0, text: t.openedDoor(professionName({ locale }, c.profession)), historyId: null });
    adultsList.push(c);
    state.characters.push(c);
  }
  for (let i = 0; i < children; i++) {
    const age = rng.int(2, ADULT_AGE - 2);
    const parent = rng.pick(adultsList.filter((a) => -a.birthTick - age >= 18));
    const c: Character = {
      id: newCharacterId(state),
      ...randomName(rng, parent?.familyName, locale),
      birthTick: -age,
      deathTick: null,
      causeOfDeath: null,
      profession: null,
      homeId: "s-haven",
      parentIds: parent ? [parent.id] : [],
      traits: [rng.pick(TRAITS)],
      lifeEvents: [{ tick: -age, text: t.bornHaven(), historyId: null }],
    };
    state.characters.push(c);
  }
  for (const c of state.characters) c.attributes = rollAttributes(rng, c, -c.birthTick);
  // Forty years underground taught some of them a craft worth passing on.
  for (const c of state.characters) {
    if (!c.profession || !rng.chance(0.15)) continue;
    const own = SPECIALTIES.filter((x) => BRANCH_INFO[SPECIALTY_INFO[x].branch].profession === c.profession);
    if (own.length) c.specialties = [rng.pick(own)];
  }
  state.stats.peakPopulation = state.characters.length;
  state.rng = rng.state;
  return state;
}
