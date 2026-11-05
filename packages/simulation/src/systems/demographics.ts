import { ADULT_AGE, POLICY_INFO, PROFESSIONS, type Character, type Profession, type Settlement } from "@genesis/schemas";
import { characterAge, fullName, hasTech, residents } from "@genesis/narrative";
import type { TickContext } from "../context";
import { newCharacterId, randomName } from "../world-factory";
import { TRAITS } from "../names";

export const DEMOGRAPHY = {
  birthChancePerPair: 0.16,
  fertileMin: 18,
  fertileMax: 45,
} as const;

/** Annual baseline mortality by age. */
export function baseMortality(age: number): number {
  if (age < 1) return 0.03;
  if (age < 5) return 0.01;
  if (age < 16) return 0.004;
  if (age < 40) return 0.006;
  if (age < 55) return 0.012;
  if (age < 65) return 0.025;
  if (age < 75) return 0.06;
  if (age < 85) return 0.14;
  return 0.3;
}

/** Aging is implicit (age = tick - birthTick); this system applies death checks. */
export function mortality(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of st.settlements) {
    if (s.status !== "active") continue;
    const people = residents(st, s.id);
    const medics = people.filter((c) => c.profession === "Medic" && characterAge(st, c) >= ADULT_AGE).length;
    const d = ctx.deficits.get(s.id) ?? { food: 0, water: 0 };
    let mult = Math.min(2.5, Math.max(0.5, 1 + (60 - s.health) / 50));
    if (hasTech(st, "field_medicine")) mult *= 0.8;
    if (hasTech(st, "antibiotics")) mult *= 0.75;
    mult *= Math.max(0.7, 1 - 0.04 * medics);
    const starvation = d.food * 0.15;
    const thirst = d.water * 0.25;

    for (const c of people) {
      const age = characterAge(st, c);
      const natural = baseMortality(age) * mult;
      const accident = c.profession === "Scout" ? 0.006 : 0;
      const p = natural + accident + starvation + thirst;
      const roll = ctx.rng.next();
      if (roll >= p) continue;

      // Attribute cause proportionally to its share of the risk.
      let cause: string;
      let causeIds: string[] = [];
      const pick = ctx.rng.next() * p;
      if (pick < thirst) {
        cause = "dehydration during the water shortage";
        if (s.shortageOrigin.water) causeIds = [s.shortageOrigin.water];
      } else if (pick < thirst + starvation) {
        cause = "starvation during the famine";
        if (s.shortageOrigin.food) causeIds = [s.shortageOrigin.food];
      } else if (pick < thirst + starvation + accident) {
        cause = "lost in the wastes while scouting";
      } else if (age >= 65) {
        cause = "old age";
      } else if (age < 5) {
        cause = "childhood illness";
      } else {
        cause = ctx.rng.pick(["fever", "infected wound", "a collapse in the ruins", "illness"]);
      }
      killCharacter(ctx, c, s, cause, causeIds);
    }
  }
}

export function killCharacter(ctx: TickContext, c: Character, s: Settlement, cause: string, causeIds: string[]): void {
  const age = characterAge(ctx.state, c);
  c.deathTick = ctx.state.tick;
  c.causeOfDeath = cause;
  ctx.state.stats.deaths += 1;
  ctx.deaths += 1;
  const notable = c.lifeEvents.length >= 5 || age >= 70;
  const e = ctx.system({
    category: "demographic",
    importance: notable ? "notable" : "minor",
    title: `Death of ${fullName(c)}`,
    text: `${fullName(c)}${c.profession ? `, ${c.profession.toLowerCase()}` : ""} of ${s.name}, died at age ${age} of ${cause}.`,
    scope: "character",
    settlementIds: [s.id],
    characterIds: [c.id],
    causeIds,
    changes: [{ path: `characters.${c.id}.alive`, label: `${fullName(c)} alive`, before: true, after: false }],
  });
  c.lifeEvents.push({ tick: ctx.state.tick, text: `Died at ${age}: ${cause}`, historyId: e.id });
}

function crowdingFactor(pop: number, capacity: number): number {
  if (pop >= capacity) return 0.08;
  if (pop / capacity > 0.85) return 0.5;
  return 1;
}

export function births(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of st.settlements) {
    if (s.status !== "active") continue;
    const people = residents(st, s.id);
    const fertile = people.filter((c) => {
      const a = characterAge(st, c);
      return a >= DEMOGRAPHY.fertileMin && a <= DEMOGRAPHY.fertileMax;
    });
    const pairs = Math.floor(fertile.length / 2);
    if (pairs === 0) continue;
    const morale = Math.min(1.2, Math.max(0.4, s.morale / 65));
    const food = s.shortage.food > 0 || s.shortage.water > 0 ? 0.2 : 1;
    const p = DEMOGRAPHY.birthChancePerPair * morale * food * crowdingFactor(people.length, s.capacity);

    for (let i = 0; i < pairs; i++) {
      if (!ctx.rng.chance(p)) continue;
      const [a, b] = ctx.rng.shuffle(fertile).slice(0, 2) as [Character, Character];
      const child: Character = {
        id: newCharacterId(st),
        ...randomName(ctx.rng, a.familyName),
        birthTick: st.tick,
        deathTick: null,
        causeOfDeath: null,
        profession: null,
        homeId: s.id,
        parentIds: [a.id, b.id],
        traits: [ctx.rng.pick(TRAITS)],
        lifeEvents: [],
      };
      st.characters.push(child);
      st.stats.births += 1;
      ctx.births += 1;
      const e = ctx.system({
        category: "demographic",
        importance: "minor",
        title: `Birth of ${fullName(child)}`,
        text: `${fullName(child)} was born in ${s.name} to ${fullName(a)} and ${fullName(b)}.`,
        scope: "character",
        settlementIds: [s.id],
        characterIds: [child.id, a.id, b.id],
      });
      child.lifeEvents.push({ tick: st.tick, text: `Born in ${s.name}`, historyId: e.id });
      a.lifeEvents.push({ tick: st.tick, text: `Child ${child.givenName} born`, historyId: e.id });
      b.lifeEvents.push({ tick: st.tick, text: `Child ${child.givenName} born`, historyId: e.id });
    }
  }
}

/** Pick the profession most under-represented relative to the policy mix. */
export function chooseProfession(ctx: TickContext, s: Settlement): Profession {
  const st = ctx.state;
  const mix = POLICY_INFO[st.policy].professionMix;
  const adults = residents(st, s.id).filter((c) => c.profession !== null);
  const total = Math.max(1, adults.length);
  const gaps = PROFESSIONS.map((p) => ({
    p,
    gap: mix[p] - adults.filter((c) => c.profession === p).length / total + ctx.rng.next() * 0.05,
  }));
  gaps.sort((x, y) => y.gap - x.gap);
  return gaps[0]!.p;
}

export function comingOfAge(ctx: TickContext): void {
  const st = ctx.state;
  for (const c of st.characters) {
    if (c.deathTick !== null || c.profession !== null) continue;
    if (characterAge(st, c) < ADULT_AGE) continue;
    const s = st.settlements.find((x) => x.id === c.homeId);
    if (!s) continue;
    c.profession = chooseProfession(ctx, s);
    c.lifeEvents.push({ tick: st.tick, text: `Came of age and began training as a ${c.profession}`, historyId: null });
  }
}
