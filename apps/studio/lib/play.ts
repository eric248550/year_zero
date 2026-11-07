import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { advanceClock, applyPlayerAction, getRun, getRunContent, listRuns, queryHistory, type ClockStatus } from "@genesis/database";
import type { Character, EventDefinition, Player, WorldState } from "@genesis/schemas";
import { characterAge, fullName, getCharacter, population, relationshipKey, governanceOf, powerLevel, projectOf, renderTemplate, rivalOf, techText, tensionBetween } from "@genesis/narrative";
import { BRANCH_INFO, CLAIM_YIELD, FACILITY_INFO, FACILITY_WORKING, LAW_INFO, SPECIALTY_INFO, TECH_BY_ID, ZH_CATALOG, type FacilityId, type LawId, type SpecialtyId } from "@genesis/schemas";
import { activeProjects, projectBlocker, proposableBranches, startableTechs, workEstimate } from "@genesis/simulation";
import type { ProjectsView } from "@/components/play/projects";
import type { DecisionView } from "@/components/play/decision-card";
import { db } from "./server";

/**
 * Closed-playtest identity: a random player id in an httpOnly cookie. There
 * are no accounts yet — whoever holds the cookie plays the character.
 */
export const PLAYER_COOKIE = "yz-player";

export async function currentPlayerId(): Promise<string | null> {
  const v = (await cookies()).get(PLAYER_COOKIE)?.value;
  return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

export function newPlayerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
}

/** Which world (server) this browser is playing in. Separate worlds, one player id. */
export const WORLD_COOKIE = "yz-world";

export interface WorldInfo {
  id: string;
  name: string;
  year: number;
  /** Years since the bunker opened. */
  tick: number;
  players: number;
  population: number;
  /** When the server opened (ISO time). */
  openedAt: string;
  /** This player's character in that world, if they have joined it. */
  me: { status: Player["status"]; name: string | null } | null;
}

/** Worlds open for play: every active run. Newest first. */
export function listWorlds(playerId: string | null): WorldInfo[] {
  const d = db();
  return listRuns(d)
    .filter((r) => r.status === "active")
    // Newest server first.
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((r) => {
      const { state } = getRun(d, r.id);
      const players = Object.values(state.players ?? {}).filter((p) => p.status !== "left");
      const mine = playerId ? state.players?.[playerId] : undefined;
      const c = mine?.characterId ? getCharacter(state, mine.characterId) : undefined;
      return {
        id: r.id,
        name: r.name,
        year: r.year,
        tick: r.currentTick,
        players: players.length,
        population: r.population,
        openedAt: r.createdAt,
        me: mine && mine.status !== "left" ? { status: mine.status, name: c ? fullName(c) : null } : null,
      };
    });
}

/** The chosen world, if it is still open; with only one world open, that one. */
export async function currentWorldId(): Promise<string | null> {
  const v = (await cookies()).get(WORLD_COOKIE)?.value;
  const open = listRuns(db()).filter((r) => r.status === "active");
  if (v && open.some((w) => w.id === v)) return v;
  return open.length === 1 ? open[0]!.id : null;
}

export interface PlayContext {
  runId: string;
  /** The world's server name, e.g. "元年 · 封測". */
  worldName: string;
  state: WorldState;
  events: readonly EventDefinition[];
  clock: ClockStatus;
  playerId: string | null;
  player: Player | null;
  character: Character | null;
}

/** Load the live world for the player app, advancing the real-time clock first. Once per request. */
export const loadPlay = cache(async (): Promise<PlayContext | null> => {
  const d = db();
  const runId = await currentWorldId();
  if (!runId) return null;
  const clock = advanceClock(d, runId);
  const { state, summary } = getRun(d, runId);
  const playerId = await currentPlayerId();
  const player = playerId ? state.players?.[playerId] ?? null : null;
  const character = player?.characterId ? getCharacter(state, player.characterId) ?? null : null;
  return { runId, worldName: summary.name, state, events: getRunContent(d, runId).events, clock, playerId, player, character };
});

/**
 * Spread a year's personal events through the year: each
 * one appears at a fixed point between 5% and 65% of the way through (from its
 * id, so every viewer sees the same), leaving time to answer.
 */
function appearAt(ctx: PlayContext, id: string, firedTick: number): string | null {
  const { state, clock } = ctx;
  if (!clock.nextTickAt || !clock.minutes || firedTick !== state.tick) return null;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const span = clock.minutes * 60_000;
  const start = Date.parse(clock.nextTickAt) - span;
  return new Date(start + span * (0.05 + (h % 1000) / 1000 * 0.6)).toISOString();
}

export interface InboxItem {
  id: string;
  year: number;
  title: string;
  text: string;
}

/**
 * What happened to this character because of someone else lately: events they
 * were part of but did not lead (another player's scene, a world event), so
 * the people affected see it too. Their own open decisions are shown as cards instead.
 */
export function inboxFor(ctx: PlayContext): InboxItem[] {
  const { state, character, runId } = ctx;
  if (!character) return [];
  const open = new Set((state.pendingDecisions ?? []).filter((p) => p.participants.includes(character.id)).map((p) => p.id));
  return queryHistory(db(), runId, { characterId: character.id, fromYear: state.startYear + state.tick - 1, order: "desc", limit: 12 })
    .items.filter((e) => e.characterIds[0] !== character.id && !open.has(e.id))
    .map((e) => ({ id: e.id, year: e.year, title: e.title, text: e.text }));
}

/** Pending decisions this character takes part in, ready to render. */
export function decisionViews(ctx: PlayContext): DecisionView[] {
  const { state, character } = ctx;
  if (!character) return [];
  return (state.pendingDecisions ?? [])
    .filter((p) => p.participants.includes(character.id))
    .map((p) => {
      const def = ctx.events.find((e) => e.id === p.definitionId);
      const settlement = p.settlementId ? state.settlements.find((s) => s.id === p.settlementId) : undefined;
      const values: Record<string, string> = { proposal: state.proposals?.find((x) => x.id === p.proposalId)?.title ?? "", settlement: settlement?.name ?? "the settlements", rival: (settlement && rivalOf(state, settlement)?.name) || "", year: String(state.startYear + p.firedTick), world: state.worldName };
      for (const [role, id] of Object.entries(p.roles)) {
        const c = getCharacter(state, id);
        const proj = c && values.project === undefined ? projectOf(state, c.id) : undefined;
        if (proj) values.project = techText(state, proj.techId).name;
        if (c) {
          values[role] = fullName(c);
          values[`${role}.profession`] = c.profession ?? "youth";
        }
      }
      return {
        id: p.id,
        title: def ? renderTemplate(def.narrative.headline, values) : p.definitionId,
        text: def ? renderTemplate(def.narrative.text, values) : "",
        choices: (def?.choices ?? []).map((c) => ({ id: c.id, label: c.label, description: c.description ?? null })),
        myChoice: p.responses[character.id] ?? null,
        others: p.participants.length - 1,
        instant: p.participants.length === 1,
        vote: def?.resolution === "vote",
        appearAt: appearAt(ctx, p.id, p.firedTick),
      };
    });
}

export function ageOf(state: WorldState, c: Character): number {
  return characterAge(state, c);
}

/** Apply an action as the current player. The player id always comes from the cookie, never the client. */
export function actAs(runId: string, playerId: string, action: Record<string, unknown>) {
  return applyPlayerAction(db(), runId, { ...action, playerId });
}

/** How a character is doing right now. 0–100, higher is better (a full hunger bar = well fed). */
export interface ConditionView {
  hunger: { value: number; foodYears: number; shortYears: number };
  thirst: { value: number; waterYears: number; shortYears: number };
  health: { value: number; personal: boolean };
  mood: { value: number; morale: number; closest: { name: string; bond: number } | null };
  abilities: { knowledge: number; social: number; survival: number } | null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** How empty the stomach is (higher = worse), from the stores at home; each year of shortage makes it worse. */
function need(stock: number, people: number, shortYears: number) {
  const years = stock / Math.max(1, people);
  const value = shortYears > 0 ? clamp(55 + 15 * shortYears) : clamp(45 - years * 15);
  return { value: shortYears > 0 ? value : Math.max(5, value), years: Math.round(years * 10) / 10 };
}

/** Derived from the world each time (nothing extra is stored), so it is always in step with the simulation. */
export function conditionOf(state: WorldState, c: Character): ConditionView {
  const home = state.settlements.find((s) => s.id === c.homeId);
  const people = home ? population(state, home.id) : 1;
  const food = need(home?.resources.food ?? 0, people, home?.shortage.food ?? 0);
  const water = need(home?.resources.water ?? 0, people, home?.shortage.water ?? 0);
  let closest: { name: string; bond: number } | null = null;
  for (const o of state.characters) {
    if (o.id === c.id || o.deathTick !== null) continue;
    const bond = state.relationships[relationshipKey(c.id, o.id)] ?? 0;
    if (bond > (closest?.bond ?? 0)) closest = { name: fullName(o), bond };
  }
  const morale = home?.morale ?? 50;
  const worstNeed = Math.max(food.value, water.value);
  // Shown like a game's hunger bar: full = fed.
  const mood = clamp(10 + morale * 0.8 + (closest ? closest.bond * 0.2 : 0) - Math.max(0, worstNeed - 50) / 2);
  const a = c.attributes;
  return {
    hunger: { value: 100 - food.value, foodYears: food.years, shortYears: home?.shortage.food ?? 0 },
    thirst: { value: 100 - water.value, waterYears: water.years, shortYears: home?.shortage.water ?? 0 },
    health: { value: a?.health ?? home?.health ?? 50, personal: !!a },
    mood: { value: mood, morale: Math.round(morale), closest },
    abilities: a ? { knowledge: a.knowledge, social: a.social, survival: a.survival } : null,
  };
}

type Term = { techName: (id: string) => string; techEffect: (id: string) => string; branch: (id: string) => string };

/** Projects where this character lives, what they could start, and what is going on elsewhere. */
export function projectsFor(state: WorldState, c: Character, term: Term): ProjectsView {
  const name = (id: string) => { const x = getCharacter(state, id); return x ? fullName(x) : null; };
  const adult = characterAge(state, c) >= 16;
  const home = state.settlements.find((s) => s.id === c.homeId);
  const all = activeProjects(state);
  const view = (p: (typeof all)[number]) => {
    const tech = TECH_BY_ID[p.techId]!;
    return {
      id: p.id,
      name: term.techName(p.techId),
      branch: term.branch(tech.branch),
      effect: term.techEffect(p.techId),
      percent: Math.min(100, Math.round((p.progress / tech.cost) * 100)),
      yearsLeft: p.lastGain > 0 ? Math.max(1, Math.ceil((tech.cost - p.progress) / p.lastGain)) : null,
      lead: p.leadId ? name(p.leadId) : null,
      leadIsMe: p.leadId === c.id,
      people: new Set([p.leadId, ...p.crewIds, ...p.memberIds].filter(Boolean)).size,
      players: p.memberIds.filter((id) => id !== c.id).map((id) => name(id)).filter((x): x is string => !!x),
      mine: p.memberIds.includes(c.id),
      myWork: workEstimate(state, c, p.techId, true),
      fits: c.profession === BRANCH_INFO[tech.branch].profession,
      approach: p.approach ?? "steady",
      log: (p.log ?? []).slice(-3).reverse().map((l) => ({ year: state.startYear + l.tick, text: l.text })),
      canDonate: p.memberIds.includes(c.id) && p.donations?.[c.id] !== state.tick && (state.settlements.find((s) => s.id === p.settlementId)?.resources.materials ?? 0) >= 10,
      place: state.settlements.find((s) => s.id === p.settlementId)?.name ?? "",
    };
  };
  return {
    canWork: adult,
    leading: all.some((p) => p.leadId === c.id),
    here: all.filter((p) => p.settlementId === c.homeId).map(view),
    elsewhere: all.filter((p) => p.settlementId !== c.homeId).map(view),
    startable: startableTechs(state).filter((t) => proposableBranches(c.profession).includes(t.branch)).map((t) => ({
      tech: t.id,
      name: term.techName(t.id),
      branch: term.branch(t.branch),
      effect: term.techEffect(t.id),
      materials: t.materials,
      enough: projectBlocker(state, t.id, home) === null,
      fits: c.profession === BRANCH_INFO[t.branch].profession,
      myWork: workEstimate(state, c, t.id, true),
    })).sort((a, b) => Number(b.fits) - Number(a.fits)),
    materials: Math.floor(home?.resources.materials ?? 0),
  };
}

export type RelationLevel = "warm" | "calm" | "tense" | "hostile";

/** How the character's home gets on with every other settlement, worst first. */
export function neighboursOf(state: WorldState, c: Character): { name: string; tension: number; level: RelationLevel }[] {
  const home = state.settlements.find((s) => s.id === c.homeId);
  if (!home) return [];
  return state.settlements
    .filter((s) => s.status === "active" && s.id !== home.id)
    .map((s) => {
      const tension = Math.round(tensionBetween(state, home.id, s.id));
      const level: RelationLevel = tension >= 60 ? "hostile" : tension >= 35 ? "tense" : tension >= 10 ? "calm" : "warm";
      return { name: s.name, tension, level };
    })
    .sort((a, b) => b.tension - a.tension);
}

export interface ProposalView { title: string; proposer: string; status: "open" | "executed" | "rejected" | "failed"; deciders: string; yes: number; no: number; year: number }

export interface HomeView {
  proposals: ProposalView[];
  governance: string;
  farm: { seeds: number; fertility: number; plan: string; growing: number; readyLabel: string | null; harvests: number } | null;
  power: number;
  salvage: number;
  wild: number;
  facilities: { id: string; name: string; effect: string; condition: number; working: boolean }[];
  laws: { id: string; name: string; effect: string }[];
  claims: { name: string; yields: string }[];
}

/** What stands, what rules, and what is claimed where the character lives. */
export function homeOf(state: WorldState, c: Character, zh: boolean): HomeView | null {
  const home = state.settlements.find((s) => s.id === c.homeId);
  if (!home) return null;
  const res = (r: string) => (zh ? ({ food: "食物", water: "水", materials: "物資", knowledge: "知識" } as Record<string, string>)[r] ?? r : r);
  const loc = state.locations.find((l) => l.id === home.locationId);
  const plans = zh ? { staple: "高產主糧", rotation: "輪作", seedsave: "多留種" } : { staple: "staple crops", rotation: "rotation", seedsave: "seed saving" };
  const seasons = zh ? ["春天", "夏天", "秋天", "冬天"] : ["spring", "summer", "autumn", "winter"];
  const growing = home.farm?.crops.reduce((n, c) => n + c.seeds, 0) ?? 0;
  const ready = home.farm?.crops.length ? Math.min(...home.farm.crops.map((c) => c.readySeason)) : null;
  const name = (id: string) => { const x = getCharacter(state, id); return x ? fullName(x) : id; };
  const gov = governanceOf(state);
  const proposals = (state.proposals ?? []).filter((p) => p.settlementId === home.id).slice(-6).reverse().map((p) => ({
    title: p.title, proposer: name(p.proposerId), status: p.status, year: state.startYear + (p.resolvedTick ?? p.createdTick),
    deciders: p.kind === "domain" && p.deciders.length === 1 ? name(p.deciders[0]!) : p.deciders.length === 1 ? name(p.deciders[0]!) : `${p.deciders.length}`,
    yes: p.approvedBy.length, no: p.rejectedBy.length,
  }));
  return {
    proposals,
    governance: zh ? { assembly: "居民大會投票", elders: "長者議政", heads: "各職業帶頭的人組成的議會" }[gov] : { assembly: "the assembly votes", elders: "the elders decide", heads: "the council of heads decides" }[gov],
    farm: home.kind === "bunker" && !home.farm?.seeds ? null : home.farm ? {
      seeds: Math.round(home.farm.seeds), fertility: Math.round(home.farm.fertility), plan: plans[home.farm.plan ?? "seedsave"], growing: Math.round(growing),
      readyLabel: ready === null ? null : `${state.startYear + Math.floor(ready / 4)} ${seasons[ready % 4]}`, harvests: home.farm.harvests,
    } : null,
    power: Math.round(powerLevel(state, home) * 100),
    salvage: Math.round(loc?.salvage ?? 0),
    wild: Math.round(loc?.wild ?? 0),
    facilities: (Object.entries(home.facilities ?? {}) as [FacilityId, number][]).map(([id, condition]) => ({
      id, condition: Math.round(condition), working: condition >= FACILITY_WORKING,
      name: zh ? ZH_CATALOG.facility[id] : FACILITY_INFO[id].name,
      effect: zh ? ZH_CATALOG.facilityEffect[id] : FACILITY_INFO[id].effect,
    })),
    laws: (home.laws ?? []).map((id: LawId) => ({ id, name: zh ? ZH_CATALOG.law[id] : LAW_INFO[id].name, effect: zh ? ZH_CATALOG.lawEffect[id] : LAW_INFO[id].effect })),
    claims: state.locations.filter((l) => l.claimedBy === home.id).map((l) => ({
      name: zh ? ZH_CATALOG.locationName[l.id as keyof typeof ZH_CATALOG.locationName] ?? l.id : l.id,
      yields: Object.entries(CLAIM_YIELD[l.id] ?? {}).map(([r, n]) => `${res(r)} +${n}`).join("、"),
    })),
  };
}

/** The character's skills, and when they are back if away. */
export function personalOf(state: WorldState, c: Character, zh: boolean): { specialties: { name: string; effect: string }[]; awayUntil: { year: number; season: string } | null } {
  const seasons = zh ? ["春天", "夏天", "秋天", "冬天"] : ["spring", "summer", "autumn", "winter"];
  return {
    specialties: (c.specialties ?? []).map((x: SpecialtyId) => ({ name: zh ? ZH_CATALOG.specialty[x] : SPECIALTY_INFO[x].name, effect: zh ? ZH_CATALOG.specialtyEffect[x] : SPECIALTY_INFO[x].effect })),
    awayUntil: c.awayUntil !== undefined && c.awayUntil >= state.tick * 4 ? { year: state.startYear + Math.floor(c.awayUntil / 4), season: seasons[c.awayUntil % 4]! } : null,
  };
}

/** What this player's earlier lives left behind: the people they were and what they did that is on record. */
export function legacyOf(state: WorldState, player: Player): { name: string; years: string; deeds: string[]; skills: string[] }[] {
  return player.lineage.slice(0, -1).reverse().map((id) => {
    const c = getCharacter(state, id);
    if (!c) return null;
    const zh = state.locale === "zh-TW";
    return {
      name: fullName(c),
      years: `${state.startYear + c.birthTick}–${c.deathTick !== null ? state.startYear + c.deathTick : ""}`,
      deeds: c.lifeEvents.filter((l) => l.historyId && l.tick >= 0).slice(-4).map((l) => `${state.startYear + l.tick} ${l.text}`),
      skills: (c.specialties ?? []).map((x) => (zh ? ZH_CATALOG.specialty[x] : SPECIALTY_INFO[x].name)),
    };
  }).filter((x): x is NonNullable<typeof x> => !!x);
}
