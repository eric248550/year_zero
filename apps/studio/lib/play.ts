import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { advanceClock, applyPlayerAction, getRun, getRunContent, listRuns, type ClockStatus } from "@genesis/database";
import type { Character, EventDefinition, Player, WorldState } from "@genesis/schemas";
import { characterAge, fullName, getCharacter, population, relationshipKey, renderTemplate } from "@genesis/narrative";
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

/** Pending decisions this character takes part in, ready to render. */
export function decisionViews(ctx: PlayContext): DecisionView[] {
  const { state, character } = ctx;
  if (!character) return [];
  return (state.pendingDecisions ?? [])
    .filter((p) => p.participants.includes(character.id))
    .map((p) => {
      const def = ctx.events.find((e) => e.id === p.definitionId);
      const settlement = p.settlementId ? state.settlements.find((s) => s.id === p.settlementId) : undefined;
      const values: Record<string, string> = { settlement: settlement?.name ?? "the settlements", year: String(state.startYear + p.firedTick), world: state.worldName };
      for (const [role, id] of Object.entries(p.roles)) {
        const c = getCharacter(state, id);
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
