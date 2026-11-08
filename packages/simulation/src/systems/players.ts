import {
  ADULT_AGE,
  PROFESSIONS,
  PROLOGUE_ORDER,
  PROLOGUE_STEPS,
  TECH_BY_ID,
  BRANCH_INFO,
  type Character,
  type InviteKind,
  type OriginId,
  type PlayerAction,
  type Player,
  type Settlement,
  type WorldState,
} from "@genesis/schemas";
import { activeSettlements, characterAge, fullName, getCharacter, getSettlement, isAwayNow, isZh, relationshipKey, residents, say } from "@genesis/narrative";
import type { TickContext } from "../context";
import { newCharacterId, randomName } from "../world-factory";
import { TRAITS } from "../names";
import { initAttributes } from "./attributes";
import { closeKin } from "./demographics";
import { cancelWork, proposePriority, startWork, workBlocker } from "./work";
import { activeProjects, donateToProject, joinProject, logProject, projectBlocker, projectFor, proposableBranches, startProject } from "./projects";

type PlayerActionOf<T extends PlayerAction["type"]> = Extract<PlayerAction, { type: T }>;
export type IndividualAction = PlayerActionOf<"JOIN_WORLD" | "CHOOSE" | "CONTINUE_AS" | "CARE_FOR" | "INVITE" | "LEAVE_WORLD" | "PROLOGUE" | "RENAME" | "START_PROJECT" | "JOIN_PROJECT" | "PROJECT_APPROACH" | "DONATE_PROJECT" | "START_WORK" | "CANCEL_WORK" | "PROPOSE_PRIORITY">;

export const PLAYERS = {
  /** Unaccepted invites expire after this many ticks (one real week in the live game). */
  inviteTtl: 7,
  /** Relationship strength at which an NPC counts as a close companion. */
  companionThreshold: 50,
  /** Wanderers start arriving from the wastes in this year of the world. */
  wandererTick: 8,
  /** A surface settlement must have stood this many ticks before people can have grown up there. */
  surfaceBornTick: 1,
  /** Age range of a "random rebirth" into an existing child. */
  rebirthAge: [6, 15] as const,
  careRelationship: 15,
} as const;

const HAVEN_ID = "s-haven";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function getPlayer(state: WorldState, playerId: string): Player | undefined {
  return state.players?.[playerId];
}

export function playerCharacter(state: WorldState, playerId: string): Character | undefined {
  const p = getPlayer(state, playerId);
  if (!p || p.status !== "active" || !p.characterId) return undefined;
  const c = getCharacter(state, p.characterId);
  return c && c.deathTick === null ? c : undefined;
}

/** A character an unaccepted, unexpired invite is holding for someone. */
export function isReserved(state: WorldState, characterId: string): boolean {
  return Object.values(state.invites ?? {}).some((i) => i.characterId === characterId && i.acceptedBy === null && i.expiresTick >= state.tick);
}

function isFree(state: WorldState, c: Character): boolean {
  return c.deathTick === null && !c.controllerId && !isReserved(state, c.id);
}

/** How `other` is tied to `self`, if closely enough to continue as them or invite a friend to play them. */
export function bondKind(state: WorldState, self: Character, other: Character): Exclude<InviteKind, "next_child"> | null {
  if (other.id === self.id) return null;
  if (other.parentIds.includes(self.id)) return "child";
  if (other.caretakerIds?.includes(self.id)) return "ward";
  if ((state.relationships[relationshipKey(self.id, other.id)] ?? 0) >= PLAYERS.companionThreshold) return "companion";
  return null;
}

export interface SuccessionCandidate {
  characterId: string;
  kind: Exclude<InviteKind, "next_child">;
}

/** Characters a player whose character died may continue as: free children, wards and close companions. */
export function successionCandidates(state: WorldState, playerId: string): SuccessionCandidate[] {
  const p = getPlayer(state, playerId);
  const lastId = p?.lineage.at(-1);
  const last = lastId ? getCharacter(state, lastId) : undefined;
  if (!p || !last) return [];
  const out: SuccessionCandidate[] = [];
  for (const c of state.characters) {
    if (!isFree(state, c)) continue;
    const kind = bondKind(state, last, c);
    if (kind) out.push({ characterId: c.id, kind });
  }
  return out;
}

export interface OriginInfo {
  id: OriginId;
  available: boolean;
  /** Why it is locked, or null when available. */
  reason: string | null;
  /** Settlements a character of this origin can start in. */
  settlementIds: string[];
}

/** Where new players can come from right now. Year 0 offers only Haven Deep; more open as the world develops. */
export function availableOrigins(state: WorldState): OriginInfo[] {
  const active = activeSettlements(state);
  const haven = getSettlement(state, HAVEN_ID);
  const surface = active.filter((s) => s.kind === "settlement" && state.tick - s.foundedTick >= PLAYERS.surfaceBornTick);
  const vault12 = state.flags["mystery.vault12_opened"] === true;
  const anyActive = active.map((s) => s.id);
  return [
    {
      id: "haven_deep",
      available: haven?.status === "active",
      reason: haven?.status === "active" ? null : "Haven Deep has been abandoned",
      settlementIds: haven?.status === "active" ? [HAVEN_ID] : [],
    },
    {
      id: "surface_born",
      available: surface.length > 0,
      reason: surface.length > 0 ? null : "Opens once a surface settlement has stood for a year",
      settlementIds: surface.map((s) => s.id),
    },
    {
      id: "wanderer",
      available: state.tick >= PLAYERS.wandererTick && anyActive.length > 0,
      reason: state.tick >= PLAYERS.wandererTick ? (anyActive.length > 0 ? null : "No settlement left to arrive at") : `Wanderers start arriving in ${state.startYear + PLAYERS.wandererTick}`,
      settlementIds: state.tick >= PLAYERS.wandererTick ? anyActive : [],
    },
    {
      id: "vault12",
      available: vault12 && anyActive.length > 0,
      reason: vault12 ? (anyActive.length > 0 ? null : "No settlement left to arrive at") : "Opens if someone opens Vault 12",
      settlementIds: vault12 ? anyActive : [],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function inviteForJoin(state: WorldState, code: string) {
  const invite = state.invites?.[code];
  if (!invite) return { error: "Invite code not found" } as const;
  if (invite.acceptedBy !== null) return { error: "This invite has already been used" } as const;
  if (invite.expiresTick < state.tick) return { error: "This invite has expired" } as const;
  const inviter = playerCharacter(state, invite.fromPlayerId);
  if (!inviter || inviter.id !== invite.fromCharacterId) return { error: "The person who invited you is no longer alive" } as const;
  if (invite.characterId) {
    const c = getCharacter(state, invite.characterId);
    if (!c || c.deathTick !== null) return { error: "The invited character has died" } as const;
    if (c.controllerId) return { error: "Someone else is already playing this character" } as const;
  }
  return { invite } as const;
}

export function validatePlayerAction(ctx: TickContext, a: IndividualAction): string | null {
  const st = ctx.state;
  const player = getPlayer(st, a.playerId);
  switch (a.type) {
    case "JOIN_WORLD": {
      if (player && player.status !== "left") return `${player.name} is already in this world`;
      if (a.trait && !(TRAITS as readonly string[]).includes(a.trait)) return `Unknown trait ${a.trait}`;
      if (a.inviteCode) {
        const r = inviteForJoin(st, a.inviteCode);
        return "error" in r ? r.error! : null;
      }
      const origin = availableOrigins(st).find((o) => o.id === (a.origin ?? "haven_deep"))!;
      if (!origin.available) return origin.reason;
      if (a.settlementId && !origin.settlementIds.includes(a.settlementId)) return `That origin cannot start in ${a.settlementId}`;
      if (a.characterId) {
        if (origin.id !== "haven_deep") return "Only Haven Deep residents can be taken over when joining";
        const c = getCharacter(st, a.characterId);
        if (!c || c.homeId !== HAVEN_ID) return "That character does not live in Haven Deep";
        if (!isFree(st, c)) return `${fullName(c)} is not available`;
        if (characterAge(st, c) < 12) return `${fullName(c)} is too young to take over`;
      }
      return null;
    }
    case "CHOOSE": {
      const c = playerCharacter(st, a.playerId);
      if (!c) return "You have no living character";
      const pending = (st.pendingDecisions ?? []).find((p) => p.id === a.decisionId);
      if (!pending) return "That decision is closed or does not exist";
      if (!pending.participants.includes(c.id)) return `${fullName(c)} is not part of this decision`;
      return null;
    }
    case "CONTINUE_AS": {
      if (!player || player.status !== "awaiting_succession") return "You can continue only after your character has died";
      if (a.mode === "character") {
        if (!a.characterId) return "Choose who to continue as";
        if (!successionCandidates(st, a.playerId).some((x) => x.characterId === a.characterId)) {
          return "You can continue only as a free child, ward or close companion of your last character";
        }
        return null;
      }
      return activeSettlements(st).length > 0 ? null : "No settlement is left to be born into";
    }
    case "CARE_FOR": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (characterAge(st, me) < ADULT_AGE) return "You are too young to look after someone";
      const target = getCharacter(st, a.characterId);
      if (!target || target.deathTick !== null) return "That person is not alive";
      if (target.id === me.id) return "You cannot care for yourself";
      if (target.homeId !== me.homeId) return `${fullName(target)} lives elsewhere`;
      if (target.caretakerIds?.includes(me.id)) return `You already care for ${fullName(target)}`;
      return null;
    }
    case "INVITE": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (st.invites?.[a.code]) return "That invite code is already in use";
      if (a.characterId) {
        const c = getCharacter(st, a.characterId);
        if (!c || !isFree(st, c)) return "That character is not available";
        if (!bondKind(st, me, c)) return `You can invite a friend only as your child, ward or close companion`;
        return null;
      }
      return characterAge(st, me) >= ADULT_AGE ? null : "You are too young to invite someone as your child";
    }
    case "LEAVE_WORLD":
      return player && player.status !== "left" ? null : "You are not in this world";
    case "RENAME": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (me.givenName === a.givenName && me.familyName === a.familyName) return "That is already your name";
      return null;
    }
    case "PROLOGUE": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      const done = player!.prologue ?? [];
      if (done.includes(a.step)) return "You have already made this choice";
      const expected = PROLOGUE_ORDER.find((s) => !done.includes(s));
      if (expected !== a.step) return expected ? `Finish "${expected}" first` : "The prologue is over";
      if (!(PROLOGUE_STEPS[a.step] as readonly string[]).includes(a.choiceId)) return `Unknown choice ${a.choiceId}`;
      return null;
    }
    case "START_PROJECT": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (characterAge(st, me) < ADULT_AGE) return "You are too young to lead a project";
      if (isAwayNow(st, me)) return "You are away and cannot start anything here until you are back";
      if (activeProjects(st).some((p) => p.leadId === me.id)) return "You are already leading a project";
      const tech = TECH_BY_ID[a.tech];
      // You can only propose what your trade knows how to build.
      if (tech && !proposableBranches(me.profession).includes(tech.branch)) return `Only a ${BRANCH_INFO[tech.branch].profession} can propose ${tech.name}`;
      return projectBlocker(st, a.tech, getSettlement(st, me.homeId));
    }
    case "JOIN_PROJECT": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (a.projectId === null) return projectFor(st, me.id) ? null : "You are not on a project";
      const p = activeProjects(st).find((x) => x.id === a.projectId);
      if (!p) return "That project is finished or does not exist";
      if (p.settlementId !== me.homeId) return "You can only work on projects where you live";
      if (characterAge(st, me) < ADULT_AGE) return "You are too young to work on a project";
      if (p.memberIds.includes(me.id)) return "You are already working on it";
      if (isAwayNow(st, me)) return "You are away and cannot join anything until you are back";
      return null;
    }
    case "DONATE_PROJECT": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      const p = projectFor(st, me.id);
      if (!p) return "You are not on a project";
      if (p.donations?.[me.id] === st.tick) return "You already put materials into it this year";
      const home = getSettlement(st, p.settlementId);
      if (!home || home.resources.materials < a.amount) return `${home?.name ?? "Your settlement"} has only ${Math.floor(home?.resources.materials ?? 0)} materials`;
      return null;
    }
    case "START_WORK": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (a.requestId && [...(st.activities ?? []), ...(st.activityLog ?? [])].some((x) => x.characterId === me.id && x.requestId === a.requestId)) return "That was already submitted";
      return workBlocker(st, me, a.action, a.target, ctx.season);
    }
    case "PROPOSE_PRIORITY": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      if (characterAge(st, me) < ADULT_AGE) return "You are too young to speak for the settlement";
      if (isAwayNow(st, me)) return "You are away and cannot speak for the settlement until you are back";
      const home = getSettlement(st, me.homeId);
      if (!home) return "Your settlement is gone";
      if ((home.priority ?? null) === a.priority) return "That is already how things are";
      if (st.proposals?.some((p) => p.status === "open" && p.settlementId === home.id && p.key === "settlement-priority")) return "Someone has already proposed this; it is waiting for a decision";
      return null;
    }
    case "CANCEL_WORK": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      const w = (st.activities ?? []).find((x) => x.id === a.activityId);
      if (!w || w.characterId !== me.id) return "That is not your work";
      if (w.startSeason < ctx.season) return "It has already begun";
      return null;
    }
    case "PROJECT_APPROACH": {
      const me = playerCharacter(st, a.playerId);
      if (!me) return "You have no living character";
      const p = activeProjects(st).find((x) => x.leadId === me.id);
      if (!p) return "Only a project's lead decides how it is run";
      if ((p.approach ?? "steady") === a.approach) return "It is already run that way";
      return null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

function ensurePlayers(st: WorldState): Record<string, Player> {
  return (st.players ??= {});
}

function newPerson(ctx: TickContext, home: Settlement, age: number, profession: Character["profession"], givenName: string | undefined, story: string, trait?: string, familyName?: string): Character {
  const st = ctx.state;
  const name = randomName(ctx.rng, undefined, st.locale);
  const c: Character = {
    id: newCharacterId(st),
    givenName: givenName?.trim() || name.givenName,
    familyName: familyName?.trim() || name.familyName,
    birthTick: st.tick - age,
    deathTick: null,
    causeOfDeath: null,
    profession: age >= ADULT_AGE ? profession ?? ctx.rng.pick(PROFESSIONS) : null,
    homeId: home.id,
    parentIds: [],
    traits: [trait ?? ctx.rng.pick(TRAITS)],
    lifeEvents: [{ tick: st.tick, text: story, historyId: null }],
  };
  st.characters.push(c);
  initAttributes(st, ctx.rng, c);
  return c;
}

function takeControl(ctx: TickContext, playerId: string, playerName: string, c: Character, title: string, text: string): void {
  const st = ctx.state;
  const players = ensurePlayers(st);
  const prev = players[playerId];
  c.controllerId = playerId;
  players[playerId] = {
    ...prev,
    id: playerId,
    name: prev?.name ?? playerName,
    joinedTick: prev?.joinedTick ?? st.tick,
    status: "active",
    characterId: c.id,
    lineage: [...(prev?.lineage ?? []), c.id],
  };
  const e = ctx.system({
    category: "demographic",
    importance: "minor",
    title,
    text,
    scope: "character",
    settlementIds: [c.homeId],
    characterIds: [c.id],
    summary: "Player action (logged for replay)",
  });
  c.lifeEvents.push({ tick: st.tick, text: title, historyId: e.id });
}

export function applyPlayerAction(ctx: TickContext, a: IndividualAction): void {
  const st = ctx.state;
  switch (a.type) {
    case "JOIN_WORLD": {
      if (a.inviteCode) {
        const r = inviteForJoin(st, a.inviteCode);
        if ("error" in r) return;
        const invite = st.invites![a.inviteCode]!;
        const inviter = getCharacter(st, invite.fromCharacterId)!;
        if (invite.characterId) {
          const c = getCharacter(st, invite.characterId)!;
          delete st.invites![a.inviteCode];
          const key = relationshipKey(inviter.id, c.id);
          st.relationships[key] = Math.min(100, (st.relationships[key] ?? 0) + 10);
          takeControl(ctx, a.playerId, a.playerName, c, say(st).answersCall(fullName(c), fullName(inviter)), say(st).answersText(fullName(c), fullName(inviter)));
        } else {
          invite.acceptedBy = a.playerId;
          const players = ensurePlayers(st);
          const prev = players[a.playerId];
          players[a.playerId] = {
            id: a.playerId,
            name: prev?.name ?? a.playerName,
            joinedTick: prev?.joinedTick ?? st.tick,
            status: "awaiting_birth",
            characterId: null,
            lineage: prev?.lineage ?? [],
          };
        }
        return;
      }
      const origin = a.origin ?? "haven_deep";
      const info = availableOrigins(st).find((o) => o.id === origin)!;
      if (origin === "haven_deep" && a.characterId) {
        const c = getCharacter(st, a.characterId)!;
        if (a.givenName?.trim()) c.givenName = a.givenName.trim();
        if (a.familyName?.trim()) c.familyName = a.familyName.trim();
        takeControl(ctx, a.playerId, a.playerName, c, say(st).stepsForward(fullName(c)), say(st).takeover(fullName(c), a.playerName));
        return;
      }
      const home = getSettlement(st, a.settlementId ?? ctx.rng.pick(info.settlementIds))!;
      let c: Character;
      let title: string;
      switch (origin) {
        case "haven_deep":
          c = newPerson(ctx, home, ctx.rng.int(18, 40), a.profession ?? null, a.givenName, say(st).lowerLevels(), a.trait, a.familyName);
          title = say(st).joinHaven(fullName(c));
          break;
        case "surface_born":
          c = newPerson(ctx, home, ctx.rng.int(ADULT_AGE, 20), a.profession ?? null, a.givenName, say(st).grewUp(home.name), a.trait, a.familyName);
          title = say(st).joinSurface(fullName(c), home.name);
          break;
        case "wanderer":
          c = newPerson(ctx, home, ctx.rng.int(18, 45), a.profession ?? null, a.givenName, say(st).survivedWastes(), a.trait, a.familyName);
          title = say(st).joinWanderer(fullName(c), home.name);
          break;
        case "vault12":
          c = newPerson(ctx, home, ctx.rng.int(ADULT_AGE, 30), a.profession ?? null, a.givenName, say(st).walkedOutVault12(), a.trait, a.familyName);
          title = say(st).joinVault12(fullName(c), home.name);
          break;
      }
      takeControl(ctx, a.playerId, a.playerName, c, title, say(st).playedBy(title, a.playerName));
      return;
    }
    case "CHOOSE": {
      const c = playerCharacter(st, a.playerId)!;
      const pending = st.pendingDecisions!.find((p) => p.id === a.decisionId)!;
      pending.responses[c.id] = a.choiceId;
      return;
    }
    case "CONTINUE_AS": {
      const player = getPlayer(st, a.playerId)!;
      const lastId = player.lineage.at(-1);
      const last = lastId ? getCharacter(st, lastId) : undefined;
      if (a.mode === "character") {
        const c = getCharacter(st, a.characterId!)!;
        const kind = last ? bondKind(st, last, c) : null;
        const tie = say(st).tie(kind === "child" ? "child" : kind === "ward" ? "ward" : "companion");
        takeControl(ctx, a.playerId, player.name, c, say(st).carriesOn(fullName(c)), say(st).carriesText(player.name, fullName(c), tie, last ? fullName(last) : undefined));
        return;
      }
      const [minAge, maxAge] = PLAYERS.rebirthAge;
      const pool = st.characters.filter((c) => isFree(st, c) && characterAge(st, c) >= minAge && characterAge(st, c) <= maxAge);
      if (pool.length > 0) {
        const c = ctx.rng.pick(pool);
        takeControl(ctx, a.playerId, player.name, c, say(st).newLife(fullName(c)), say(st).rebornText(player.name, fullName(c), getSettlement(st, c.homeId)?.name ?? ""));
        return;
      }
      const home = ctx.rng.pick(activeSettlements(st));
      const adults = residents(st, home.id).filter((c) => characterAge(st, c) >= 18 && characterAge(st, c) <= 45);
      // Two people who are not close kin; one parent if there is no such pair.
      const [first, ...others] = ctx.rng.shuffle(adults);
      const second = first ? others.find((o) => !closeKin(first, o)) : undefined;
      const parents = [first, second].filter((x): x is Character => !!x);
      const name = randomName(ctx.rng, parents[0]?.familyName, st.locale);
      const baby: Character = {
        id: newCharacterId(st),
        ...name,
        birthTick: st.tick,
        deathTick: null,
        causeOfDeath: null,
        profession: null,
        homeId: home.id,
        parentIds: parents.map((p) => p.id),
        traits: [ctx.rng.pick(TRAITS)],
        lifeEvents: [{ tick: st.tick, text: say(st).bornIn(home.name), historyId: null }],
      };
      st.characters.push(baby);
      initAttributes(st, ctx.rng, baby);
      st.stats.births += 1;
      ctx.births += 1;
      for (const p of parents) p.lifeEvents.push({ tick: st.tick, text: say(st).childBorn(baby.givenName), historyId: null });
      takeControl(ctx, a.playerId, player.name, baby, say(st).birthTitle(fullName(baby)), say(st).babyText(fullName(baby), home.name, parents.map(fullName).join(isZh(st) ? "和" : " and "), player.name));
      return;
    }
    case "CARE_FOR": {
      const me = playerCharacter(st, a.playerId)!;
      const target = getCharacter(st, a.characterId)!;
      target.caretakerIds = [...(target.caretakerIds ?? []), me.id];
      const key = relationshipKey(me.id, target.id);
      const before = st.relationships[key] ?? 0;
      st.relationships[key] = Math.min(100, before + PLAYERS.careRelationship);
      const adopt = characterAge(st, target) < ADULT_AGE;
      const e = ctx.system({
        category: "social",
        importance: "minor",
        title: adopt ? say(st).careAdoptTitle(fullName(me), fullName(target)) : say(st).careTitle(fullName(me), fullName(target)),
        text: adopt ? say(st).careAdoptText(fullName(me), fullName(target)) : say(st).careText(fullName(me), fullName(target)),
        scope: "character",
        settlementIds: [me.homeId],
        characterIds: [me.id, target.id],
        changes: [{ path: `relationships.${key}`, label: `${fullName(me)} ↔ ${fullName(target)}`, before, after: st.relationships[key]! }],
        summary: "Player action (logged for replay)",
      });
      me.lifeEvents.push({ tick: st.tick, text: e.title, historyId: e.id });
      target.lifeEvents.push({ tick: st.tick, text: e.title, historyId: e.id });
      return;
    }
    case "INVITE": {
      const me = playerCharacter(st, a.playerId)!;
      const target = a.characterId ? getCharacter(st, a.characterId)! : null;
      (st.invites ??= {})[a.code] = {
        code: a.code,
        fromPlayerId: a.playerId,
        fromCharacterId: me.id,
        characterId: target?.id ?? null,
        kind: target ? bondKind(st, me, target)! : "next_child",
        createdTick: st.tick,
        expiresTick: st.tick + PLAYERS.inviteTtl,
        acceptedBy: null,
      };
      return;
    }
    case "PROLOGUE":
      prologue(ctx, a);
      return;
    case "START_PROJECT": {
      const me = playerCharacter(st, a.playerId)!;
      joinProject(st, me, null);
      startProject(ctx, TECH_BY_ID[a.tech]!, getSettlement(st, me.homeId)!, me, "player");
      return;
    }
    case "JOIN_PROJECT": {
      const me = playerCharacter(st, a.playerId)!;
      joinProject(st, me, a.projectId);
      return;
    }
    case "PROJECT_APPROACH": {
      const me = playerCharacter(st, a.playerId)!;
      const p = activeProjects(st).find((x) => x.leadId === me.id)!;
      p.approach = a.approach;
      logProject(p, st.tick, say(st).projectApproachLog(fullName(me), a.approach));
      return;
    }
    case "DONATE_PROJECT": {
      const me = playerCharacter(st, a.playerId)!;
      donateToProject(ctx, me, a.amount);
      return;
    }
    case "START_WORK": {
      const me = playerCharacter(st, a.playerId)!;
      startWork(ctx, me, a.action, a.target, a.requestId);
      return;
    }
    case "PROPOSE_PRIORITY": {
      proposePriority(ctx, playerCharacter(st, a.playerId)!, a.priority);
      return;
    }
    case "CANCEL_WORK": {
      cancelWork(ctx, (st.activities ?? []).find((x) => x.id === a.activityId)!);
      return;
    }
    case "RENAME": {
      const me = playerCharacter(st, a.playerId)!;
      const before = fullName(me);
      me.givenName = a.givenName;
      me.familyName = a.familyName;
      const e = ctx.system({
        category: "social",
        importance: "minor",
        title: say(st).renamed(before, fullName(me)),
        text: say(st).renamed(before, fullName(me)),
        scope: "character",
        settlementIds: [me.homeId],
        characterIds: [me.id],
        changes: [{ path: `characters.${me.id}.name`, label: "Name", before, after: fullName(me) }],
        summary: "Player action (logged for replay)",
      });
      me.lifeEvents.push({ tick: st.tick, text: e.title, historyId: e.id });
      return;
    }
    case "LEAVE_WORLD": {
      const player = getPlayer(st, a.playerId)!;
      const c = player.characterId ? getCharacter(st, player.characterId) : undefined;
      if (c) delete c.controllerId;
      player.status = "left";
      player.characterId = null;
      for (const [code, inv] of Object.entries(st.invites ?? {})) {
        if (inv.fromPlayerId === a.playerId || inv.acceptedBy === a.playerId) delete st.invites![code];
      }
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Prologue                                                            */
/* ------------------------------------------------------------------ */

/** Someone at home to share the moment with: prefer the profession, never yourself or `avoid`. */
function companionFor(ctx: TickContext, me: Character, profession: Character["profession"] | null, avoid: readonly string[]): Character | undefined {
  const st = ctx.state;
  const pool = residents(st, me.homeId).filter((c) => c.id !== me.id && !avoid.includes(c.id) && characterAge(st, c) >= ADULT_AGE);
  const preferred = profession ? pool.filter((c) => c.profession === profession) : [];
  const from = preferred.length ? preferred : pool;
  return from.length ? ctx.rng.pick(from) : undefined;
}

function bond(st: WorldState, a: Character, b: Character, delta: number) {
  const key = relationshipKey(a.id, b.id);
  const before = st.relationships[key] ?? 0;
  st.relationships[key] = Math.max(-100, Math.min(100, before + delta));
  return { path: `relationships.${key}`, label: `${fullName(a)} ↔ ${fullName(b)}`, before, after: st.relationships[key]! };
}

/** The three first-session choices. Small, immediate, and they introduce one person who will be back. */
function prologue(ctx: TickContext, a: PlayerActionOf<"PROLOGUE">): void {
  const st = ctx.state;
  const player = getPlayer(st, a.playerId)!;
  const me = playerCharacter(st, a.playerId)!;
  const home = getSettlement(st, me.homeId)!;
  // Each prologue scene introduces someone new.
  const met = Object.keys(st.relationships).filter((k) => k.split("|").includes(me.id)).map((k) => k.split("|").find((id) => id !== me.id)!);
  player.prologue = [...(player.prologue ?? []), a.step];
  // Each first choice leaves a small mark on who you are.
  const NUDGE: Record<string, [keyof NonNullable<Character["attributes"]>, number]> = {
    surface: ["survival", 3], repair: ["knowledge", 3], share: ["social", 3], refuse: ["survival", 2], tell: ["social", 2], keep: ["knowledge", 2],
  };
  const nudge = NUDGE[a.choiceId];
  if (me.attributes && nudge) me.attributes[nudge[0]] = Math.min(100, me.attributes[nudge[0]] + nudge[1]);

  const record = (title: string, text: string, other: Character | undefined, changes: ReturnType<typeof bond>[], minor = true) => {
    const e = ctx.system({
      category: "social",
      importance: minor ? "minor" : "notable",
      title,
      text,
      scope: "character",
      settlementIds: [home.id],
      characterIds: other ? [me.id, other.id] : [me.id],
      changes,
      summary: `Prologue choice: ${a.step} → ${a.choiceId}`,
    });
    me.lifeEvents.push({ tick: st.tick, text: title, historyId: e.id });
    if (other) other.lifeEvents.push({ tick: st.tick, text: title, historyId: e.id });
  };

  switch (a.step) {
    case "first_climb": {
      const surface = a.choiceId === "surface";
      const partner = companionFor(ctx, me, surface ? "Scout" : "Engineer", met);
      const changes = partner ? [bond(st, me, partner, 20)] : [];
      if (!surface) {
        const before = home.resources.water;
        home.resources.water = Math.round((before + 2) * 100) / 100;
        changes.push({ path: `settlements.${home.id}.resources.water`, label: `${home.name} water`, before, after: home.resources.water });
      }
      record(
        surface ? say(st).climbTitle(fullName(me), partner && fullName(partner)) : say(st).repairTitle(fullName(me), partner && fullName(partner)),
        surface ? say(st).climbText() : say(st).repairText(),
        partner,
        changes,
      );
      return;
    }
    case "water": {
      const share = a.choiceId === "share";
      const asker = companionFor(ctx, me, null, met);
      record(
        share ? say(st).shareTitle(fullName(me), asker && fullName(asker)) : say(st).refuseTitle(fullName(me), asker && fullName(asker)),
        share ? say(st).shareText() : say(st).refuseText(),
        asker,
        asker ? [bond(st, me, asker, share ? 25 : -15)] : [],
      );
      return;
    }
    case "static": {
      const tell = a.choiceId === "tell";
      if (tell) {
        record(say(st).tellTitle(fullName(me)), say(st).tellText(), undefined, [], false);
      } else {
        me.lifeEvents.push({ tick: st.tick, text: say(st).keptStatic(), historyId: null });
      }
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* End-of-tick bookkeeping                                             */
/* ------------------------------------------------------------------ */

/**
 * Runs after every other system. Players whose character died this tick await
 * succession; invites expire; friends invited as "your next child" are born.
 * Consumes no randomness.
 */
export function playerUpkeep(ctx: TickContext): void {
  const st = ctx.state;
  if (!st.players && !st.invites) return;

  for (const p of Object.values(st.players ?? {})) {
    if (p.status !== "active" || !p.characterId) continue;
    const c = getCharacter(st, p.characterId);
    if (c && c.deathTick === null) continue;
    p.status = "awaiting_succession";
    p.characterId = null;
  }

  for (const [code, inv] of Object.entries(st.invites ?? {})) {
    const inviter = getCharacter(st, inv.fromCharacterId);
    const inviterGone = !inviter || inviter.deathTick !== null || getPlayer(st, inv.fromPlayerId)?.characterId !== inviter.id;
    if (inv.acceptedBy === null) {
      if (inv.expiresTick < st.tick || inviterGone) delete st.invites![code];
      continue;
    }
    // Accepted "next child" invite: wait for a birth to the inviter.
    const waiting = getPlayer(st, inv.acceptedBy);
    if (!waiting || waiting.status !== "awaiting_birth") {
      delete st.invites![code];
      continue;
    }
    const baby = inviter
      ? st.characters.find((c) => c.birthTick === st.tick && c.deathTick === null && !c.controllerId && c.parentIds.includes(inviter.id))
      : undefined;
    if (baby) {
      delete st.invites![code];
      takeControl(ctx, waiting.id, waiting.name, baby, say(st).inviteBorn(fullName(baby)), say(st).inviteBornText(fullName(inviter!), fullName(baby), waiting.name));
    } else if (inviterGone) {
      delete st.invites![code];
      waiting.status = "left";
    }
  }
}
