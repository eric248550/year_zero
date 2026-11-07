import { ADULT_AGE, LOCATION_BY_ID, type Character, type Settlement } from "@genesis/schemas";
import {
  activeSettlements,
  changeTension,
  characterAge,
  fullName,
  hasTech,
  newRecorder,
  population,
  residents,
  round2,
  resourceName,
  say,
  tensionBetween,
} from "@genesis/narrative";
import type { TickContext } from "../context";
import { killCharacter } from "./demographics";
import { foundSettlement, foundingBlocker } from "./settlements";

/**
 * Conflict: settlements are not one happy family. Tension between each pair
 * rises with neglect, inequality and crowding and fades with trade and law.
 * High tension stops aid and, when one side is starving, leads to raids.
 * Inside a settlement, crowding and low morale can split it: a group walks
 * out to start over somewhere else.
 */
export const CONFLICT = {
  /** Above this, councils refuse to send each other aid. */
  refuseAidAt: 50,
  /** Above this, a starving settlement may raid its rival. */
  raidAt: 60,
  raidChance: 0.15,
  desperateRaidChance: 0.45,
  raidDeathChance: 0.3,
  /** Yearly drift. */
  decay: 0.5,
  tradeDecay: 1,
  charterDecay: 1,
  radioDecay: 0.5,
  /** Bunker people and surface people live differently and judge each other for it, until trade mixes them. */
  waysOfLife: 1,
  crowding: 2,
  /** One side is full and the other has room but does not take people in. */
  noRoom: 1.5,
  inequality: 3,
  refusedAid: 8,
  aidGiven: -3,
  outpostBurden: 1,
  raidTension: 15,
  /** Splits: only settlements this large, and crowded or unhappy. */
  schismMinPop: 40,
  schismChance: 0.15,
  schismTension: 55,
} as const;

const yearsOf = (s: Settlement, r: "food" | "water", pop: number) => s.resources[r] / Math.max(1, pop);

/** Yearly drift of every pair's tension. Runs after consumption, so this year's shortages count. */
export function friction(ctx: TickContext): void {
  const st = ctx.state;
  const active = activeSettlements(st);
  let decay = CONFLICT.decay;
  if (hasTech(st, "trade_routes")) decay += CONFLICT.tradeDecay;
  if (hasTech(st, "civic_charter")) decay += CONFLICT.charterDecay;
  if (hasTech(st, "radio")) decay += CONFLICT.radioDecay;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const pa = population(st, a.id);
      const pb = population(st, b.id);
      let delta = -decay;
      const fa = pa >= a.capacity * 0.9;
      const fb = pb >= b.capacity * 0.9;
      if (fa && fb) delta += CONFLICT.crowding;
      else if ((fa && pb < b.capacity * 0.8) || (fb && pa < a.capacity * 0.8)) delta += CONFLICT.noRoom;
      if (a.kind !== b.kind && !hasTech(st, "trade_routes")) delta += CONFLICT.waysOfLife;
      const ya = Math.min(yearsOf(a, "food", pa), yearsOf(a, "water", pa));
      const yb = Math.min(yearsOf(b, "food", pb), yearsOf(b, "water", pb));
      if ((ya >= 2 && yb < 1) || (yb >= 2 && ya < 1)) delta += CONFLICT.inequality;
      changeTension(st, a.id, b.id, delta);
    }
  }
}

/**
 * Bitter neighbours clash. The poorer side (per person) takes food, water or
 * materials from the richer one; a settlement that is short, or nearly, is
 * far more likely to do it. Someone may die.
 */
export function raids(ctx: TickContext): void {
  const st = ctx.state;
  const active = activeSettlements(st);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const x = active[i]!;
      const y = active[j]!;
      if (tensionBetween(st, x.id, y.id) < CONFLICT.raidAt) continue;
      const px = Math.max(1, population(st, x.id));
      const py = Math.max(1, population(st, y.id));
      const wealth = (s: Settlement, p: number) => (s.resources.food + s.resources.water + s.resources.materials) / p;
      const [raider, victim] = wealth(x, px) <= wealth(y, py) ? [x, y] : [y, x];
      const pop = raider === x ? px : py;
      const low = (r: "food" | "water") => raider.shortage[r] > 0 || raider.resources[r] < pop * 0.5;
      const desperate = low("food") || low("water");
      if (!ctx.rng.chance(desperate ? CONFLICT.desperateRaidChance : CONFLICT.raidChance)) continue;
      const r = low("water") ? "water" : low("food") ? "food" : victim.resources.materials >= victim.resources.food ? "materials" : "food";
      if (victim.resources[r] < 10) continue;
      raid(ctx, raider, victim, r, pop);
    }
  }
}

function raid(ctx: TickContext, raider: Settlement, victim: Settlement, r: "food" | "water" | "materials", pop: number): void {
  const st = ctx.state;
  const fighters = residents(st, raider.id).filter((c) => !c.controllerId && characterAge(st, c) >= ADULT_AGE);
  if (fighters.length === 0) return;
  const leader = [...fighters].sort((x, y) => Number(y.profession === "Scout") - Number(x.profession === "Scout") || (y.attributes?.survival ?? 0) - (x.attributes?.survival ?? 0) || (x.id < y.id ? -1 : 1))[0]!;
  const take = round2(Math.min(victim.resources[r] * (0.15 + 0.1 * ctx.rng.next()), pop * 1.2));
  const rec = newRecorder();
  const vb = victim.resources[r];
  victim.resources[r] = round2(vb - take);
  rec.changes.push({ path: `settlements.${victim.id}.resources.${r}`, label: `${victim.name} ${r}`, before: vb, after: victim.resources[r] });
  const rb = raider.resources[r];
  raider.resources[r] = round2(rb + take);
  rec.changes.push({ path: `settlements.${raider.id}.resources.${r}`, label: `${raider.name} ${r}`, before: rb, after: raider.resources[r] });
  changeTension(st, raider.id, victim.id, CONFLICT.raidTension, rec);
  const mb = victim.morale;
  victim.morale = Math.max(0, victim.morale - 6);
  rec.changes.push({ path: `settlements.${victim.id}.morale`, label: `${victim.name} morale`, before: mb, after: victim.morale });
  // Everyone who lives in either place hears about it, players included.
  const players = st.characters.filter((c) => c.deathTick === null && c.controllerId && (c.homeId === raider.id || c.homeId === victim.id)).map((c) => c.id);
  const e = ctx.system({
    category: "social",
    importance: "major",
    title: say(st).raidTitle(raider.name, victim.name),
    text: say(st).raidText(fullName(leader), raider.name, victim.name, Math.round(take), resourceName(st, r)),
    settlementIds: [raider.id, victim.id],
    characterIds: [leader.id, ...players.filter((id) => id !== leader.id)],
    causeIds: r !== "materials" && raider.shortageOrigin[r] ? [raider.shortageOrigin[r]!] : [],
    changes: rec.changes,
    summary: `Tension ≥ ${CONFLICT.raidAt}; ${raider.name} is the poorer side`,
  });
  leader.lifeEvents.push({ tick: st.tick, text: say(st).raidLife(victim.name), historyId: e.id });
  if (ctx.rng.chance(CONFLICT.raidDeathChance)) {
    const pool = [...fighters, ...residents(st, victim.id).filter((c) => !c.controllerId && characterAge(st, c) >= ADULT_AGE)];
    const dead = ctx.rng.pick(pool);
    killCharacter(ctx, dead, dead.homeId === raider.id ? raider : victim, say(st).causeRaid(), [e.id]);
  }
}

/** Crowded or unhappy big settlements can split. The ones who leave carry a grudge. */
export function schisms(ctx: TickContext): void {
  const st = ctx.state;
  for (const s of activeSettlements(st)) {
    const pop = population(st, s.id);
    if (pop < CONFLICT.schismMinPop) continue;
    if (!(pop > s.capacity * 0.9 || s.morale < 45)) continue;
    if (!ctx.rng.chance(CONFLICT.schismChance * (hasTech(st, "civic_charter") ? 0.5 : 1))) continue;
    const npcs = residents(st, s.id).filter((c) => !c.controllerId && characterAge(st, c) >= ADULT_AGE);
    const n = Math.max(8, Math.round(npcs.length * 0.2));
    const leader = [...npcs].sort((a, b) => (b.attributes?.social ?? 0) - (a.attributes?.social ?? 0) || (a.id < b.id ? -1 : 1))[0];
    if (!leader) continue;
    const why = pop > s.capacity * 0.9 ? say(st).schismCrowded() : say(st).schismUnhappy();
    const site = st.locations
      .filter((l) => l.discovered && !l.settlementId && LOCATION_BY_ID[l.id]!.settleable)
      .sort((a, b) => LOCATION_BY_ID[a.id]!.distance - LOCATION_BY_ID[b.id]!.distance || (a.id < b.id ? -1 : 1))[0];
    if (site && foundingBlocker(ctx, site.id, s, n) === null) {
      const e = ctx.system({
        category: "social",
        importance: "major",
        title: say(st).schismTitle(s.name),
        text: say(st).schismText(fullName(leader), s.name, n, why),
        settlementIds: [s.id],
        characterIds: [leader.id, ...playersIn(st, s.id)],
        summary: `${pop} people, capacity ${s.capacity}, morale ${Math.round(s.morale)}`,
      });
      const leaving = foundSettlement(ctx, site.id, s, n, `A group led by ${fullName(leader)} left ${s.name}`);
      leaving.supportedBy = null; // they left on bad terms: no supplies follow them
      if (leader.homeId !== leaving.id) { leader.homeId = leaving.id; }
      leader.lifeEvents.push({ tick: st.tick, text: say(st).schismLife(s.name), historyId: e.id });
      changeTension(st, s.id, leaving.id, CONFLICT.schismTension);
      continue;
    }
    // Nowhere new to go: they move to the neighbour with the most room.
    const dest = activeSettlements(st)
      .filter((o) => o.id !== s.id && o.capacity - population(st, o.id) >= n)
      .sort((a, b) => b.capacity - population(st, b.id) - (a.capacity - population(st, a.id)) || (a.id < b.id ? -1 : 1))[0];
    if (!dest) continue;
    const movers: Character[] = ctx.rng.shuffle(npcs.filter((c) => c.id !== leader.id)).slice(0, n - 1);
    movers.unshift(leader);
    const ids = new Set(movers.map((m) => m.id));
    for (const child of residents(st, s.id)) if (characterAge(st, child) < ADULT_AGE && child.parentIds.some((p) => ids.has(p)) && !child.controllerId) movers.push(child);
    for (const m of movers) m.homeId = dest.id;
    const e = ctx.system({
      category: "social",
      importance: "major",
      title: say(st).schismTitle(s.name),
      text: say(st).schismMoveText(fullName(leader), s.name, movers.length, dest.name, why),
      settlementIds: [s.id, dest.id],
      characterIds: [leader.id, ...playersIn(st, s.id)],
      changes: [{ path: `settlements.${s.id}.population`, label: `${s.name} population`, before: pop, after: pop - movers.length }],
    });
    for (const m of movers) m.lifeEvents.push({ tick: st.tick, text: say(st).schismLife(s.name), historyId: e.id });
    changeTension(st, s.id, dest.id, CONFLICT.schismTension / 2);
  }
}

function playersIn(st: TickContext["state"], settlementId: string): string[] {
  return st.characters.filter((c) => c.deathTick === null && c.controllerId && c.homeId === settlementId).map((c) => c.id);
}

/** Aid between two settlements: refused when they are at odds, and remembered either way. */
export function aidAllowed(ctx: TickContext, donor: Settlement, needy: Settlement, r: "food" | "water"): boolean {
  const st = ctx.state;
  if (tensionBetween(st, donor.id, needy.id) < CONFLICT.refuseAidAt) {
    changeTension(st, donor.id, needy.id, CONFLICT.aidGiven);
    return true;
  }
  const rec = newRecorder();
  changeTension(st, donor.id, needy.id, CONFLICT.refusedAid, rec);
  if (needy.shortage[r] <= 1) {
    ctx.system({
      category: "social",
      importance: "notable",
      title: say(st).aidRefusedTitle(donor.name, needy.name),
      text: say(st).aidRefusedText(donor.name, needy.name, resourceName(st, r)),
      settlementIds: [donor.id, needy.id],
      characterIds: st.characters.filter((c) => c.deathTick === null && c.controllerId && (c.homeId === donor.id || c.homeId === needy.id)).map((c) => c.id),
      causeIds: needy.shortageOrigin[r] ? [needy.shortageOrigin[r]!] : [],
      changes: rec.changes,
      summary: `Tension ${Math.round(tensionBetween(st, donor.id, needy.id))} ≥ ${CONFLICT.refuseAidAt}`,
    });
  }
  return false;
}

