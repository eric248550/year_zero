import { ADULT_AGE, type Attributes, type Character, type Rng, type WorldState } from "@genesis/schemas";
import { characterAge } from "@genesis/narrative";
import type { TickContext } from "../context";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const PROFESSION_BONUS: Record<string, Partial<Attributes>> = {
  Scientist: { knowledge: 20 },
  Engineer: { knowledge: 10, survival: 10 },
  Medic: { knowledge: 10, social: 10 },
  Scout: { survival: 20, health: 5 },
  Farmer: { survival: 15, health: 5 },
};

const TRAIT_BONUS: Record<string, Partial<Attributes>> = {
  cheerful: { social: 10 },
  gentle: { social: 10 },
  devout: { social: 5 },
  curious: { knowledge: 10 },
  brave: { survival: 10 },
  restless: { survival: 5, health: 5 },
  stubborn: { health: 5 },
  pragmatic: { survival: 5 },
  haunted: { social: -10, survival: 5 },
  secretive: { social: -10, knowledge: 5 },
};

/**
 * Starting attributes: a random base shaped by profession and nature.
 * Children start with little knowledge and survival; they grow with age.
 */
export function rollAttributes(rng: Rng, c: Pick<Character, "profession" | "traits">, age: number): Attributes {
  const a: Attributes = { health: rng.int(45, 70), social: rng.int(30, 60), knowledge: rng.int(25, 50), survival: rng.int(25, 50) };
  for (const bonus of [PROFESSION_BONUS[c.profession ?? ""], ...c.traits.map((t) => TRAIT_BONUS[t])]) {
    if (!bonus) continue;
    for (const [k, v] of Object.entries(bonus) as [keyof Attributes, number][]) a[k] += v;
  }
  if (age < ADULT_AGE) {
    const grown = Math.max(0.2, age / ADULT_AGE);
    a.knowledge *= grown;
    a.survival *= grown;
  }
  return { health: clamp(a.health), social: clamp(a.social), knowledge: clamp(a.knowledge), survival: clamp(a.survival) };
}

/** Give a new character attributes, if this world has them. */
export function initAttributes(state: WorldState, rng: Rng, c: Character): void {
  if (c.attributes) return;
  c.attributes = rollAttributes(rng, c, characterAge(state, c));
}

/**
 * Yearly drift, without randomness: health follows the settlement's health
 * and declines with age; children learn; work trains its own skills.
 */
export function attributeDrift(ctx: TickContext): void {
  const st = ctx.state;
  for (const c of st.characters) {
    if (c.deathTick !== null || !c.attributes) continue;
    const a = c.attributes;
    const age = characterAge(st, c);
    const home = st.settlements.find((s) => s.id === c.homeId);
    if (home) {
      a.health += Math.sign(home.health - a.health);
      if (home.shortage.food > 0) a.health -= 3;
      if (home.shortage.water > 0) a.health -= 3;
    }
    if (age >= 55) a.health -= 1;
    if (age >= 70) a.health -= 1;
    if (age >= 6 && age < ADULT_AGE) {
      a.knowledge += 2 + ((home?.facilities?.schoolhouse ?? 0) >= 30 ? 1 : 0); // schoolhouse
      a.survival += 1;
    } else if (age >= ADULT_AGE && age < 65) {
      if (c.profession === "Scientist") a.knowledge += 2;
      if (c.profession === "Medic" || c.profession === "Engineer") a.knowledge += 1;
      if (c.profession === "Scout" || c.profession === "Farmer") a.survival += c.profession === "Scout" ? 2 : 1;
      if (c.profession === "Engineer") a.survival += 1;
    }
    if (age >= 60) a.survival -= 1;
    c.attributes = { health: clamp(a.health), social: clamp(a.social), knowledge: clamp(a.knowledge), survival: clamp(a.survival) };
  }
}

/** Personal mortality multiplier: health 50 = as before, 90 = 40% less likely to die, 20 = 30% more. */
export function healthMortality(c: Character): number {
  const h = c.attributes?.health;
  return h === undefined ? 1 : Math.min(1.5, Math.max(0.5, 1.5 - h / 100));
}

