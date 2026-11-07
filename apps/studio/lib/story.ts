import "server-only";
import { LOCATION_BY_ID, POLICIES, TECHNOLOGIES, type Condition, type EventDefinition, type WorldState } from "@genesis/schemas";
import { activeSettlements, checkEligibility, evaluateAll } from "@genesis/narrative";
import { FOUNDING_MATERIALS } from "@genesis/simulation";
import { getRunContent, queryHistory } from "@genesis/database";
import type { createI18n } from "./i18n/core";
import { db } from "./server";

type I18n = ReturnType<typeof createI18n>;

export interface StoryChoice {
  id: string;
  label: string;
  description: string | null;
  tags: string[];
}

export interface StoryEvent {
  id: string;
  title: string;
  /** Can happen this year (all conditions hold). */
  ready: boolean;
  /** What still has to be true, in plain words. */
  needs: string[];
  /** Can never happen in this world any more (e.g. it needs a technology to still be missing). */
  never: boolean;
  chance: number;
  choices: StoryChoice[];
  /** The choice the Studio has fixed for this event, if any. */
  override: string | null;
  /** Players decide this one themselves. */
  personal: boolean;
}

export interface StoryHappened {
  historyId: string;
  year: number;
  title: string;
  choice: string | null;
}

export interface StoryBeat {
  id: string;
  title: string;
  description: string;
  status: "done" | "next" | "later" | "missed";
  happened: StoryHappened[];
  events: StoryEvent[];
}

export interface StoryLine {
  id: string;
  title: string;
  summary: string;
  done: number;
  total: number;
  beats: StoryBeat[];
  outcomes: string[];
}

/** One plain-language line for a condition that does not hold yet. */
function plain(c: Condition, i18n: I18n): string {
  const { term } = i18n;
  const zh = i18n.locale === "zh-TW";
  const op = (o: string) => (zh ? { ">=": "至少", ">": "超過", "<=": "最多", "<": "少於", "==": "等於", "!=": "不是" }[o] ?? o : { ">=": "at least", ">": "more than", "<=": "at most", "<": "less than", "==": "exactly", "!=": "not" }[o] ?? o);
  switch (c.type) {
    case "resource":
      return zh ? `${c.scope === "world" ? "全世界" : "聚落"}的${term.resource(c.resource)}${c.perCapita ? "（每人）" : ""}要${op(c.op)} ${c.value}` : `${c.scope === "world" ? "World" : "Settlement"} ${term.resource(c.resource)}${c.perCapita ? " per person" : ""} must be ${op(c.op)} ${c.value}`;
    case "population":
      return zh ? `${c.scope === "world" ? "全世界" : "聚落"}人口要${op(c.op)} ${c.value}` : `${c.scope === "world" ? "World" : "Settlement"} population must be ${op(c.op)} ${c.value}`;
    case "technology":
      return zh ? `${c.has ? "需要先掌握" : "還沒掌握"}「${term.techName(c.tech)}」` : `${c.has ? "Needs" : "Must not yet have"} ${term.techName(c.tech)}`;
    case "flag":
      return zh ? `需要先發生相關的劇情（${c.flag}）` : `Needs an earlier story moment (${c.flag})`;
    case "secret":
      return zh ? `祕密「${term.secretTitle(c.secret)}」要${c.revealed ? "已經揭露" : "還沒揭露"}` : `Secret "${term.secretTitle(c.secret)}" must be ${c.revealed ? "revealed" : "hidden"}`;
    case "settlement_stat":
      return zh ? `聚落的${({ morale: "士氣", health: "健康", capacity: "容量", level: "等級" } as Record<string, string>)[c.stat] ?? c.stat}要${op(c.op)} ${c.value}` : `Settlement ${c.stat} must be ${op(c.op)} ${c.value}`;
    case "settlement_kind":
      return zh ? `要發生在${c.kind === "bunker" ? "地堡" : "地表聚落"}` : `Must happen in a ${c.kind}`;
    case "world_tick":
      return zh ? `開局第 ${c.value} 年之後` : `After year ${c.value} of the world`;
    case "location":
      return zh ? `要${c.discovered ? "先發現" : "還沒發現"}「${term.locationName(c.location)}」` : `${term.locationName(c.location)} must be ${c.discovered ? "discovered" : "undiscovered"}`;
    case "settlement_count":
      return zh ? `聚落數量要${op(c.op)} ${c.value}` : `Settlements must be ${op(c.op)} ${c.value}`;
    case "event_occurred":
      return zh ? `${c.occurred ? "要先發生" : "不能已經發生"}「${c.event}」` : `"${c.event}" must ${c.occurred ? "" : "not "}have happened`;
    case "shortage":
      return zh ? `聚落${c.active ? "正在缺" : "沒有缺"}${term.resource(c.resource)}` : `Settlement ${c.active ? "is short of" : "has enough"} ${term.resource(c.resource)}`;
    case "flag_any":
      return zh ? `${c.present ? "需要先發生其中之一" : "不能已經發生"}（${c.flags.join("、")}）` : `${c.present ? "Needs one of" : "Must have none of"} ${c.flags.join(", ")}`;
    case "farmable":
      return zh ? `聚落的土地${c.present ? "要能耕種（沃土、河邊，或已有灌溉）" : "不能耕種"}` : `Settlement land must ${c.present ? "" : "not "}be farmable`;
    case "children":
      return zh ? `聚落裡的孩子要${op(c.op)} ${c.value} 個` : `Children in the settlement must be ${op(c.op)} ${c.value}`;
    case "site_feature":
      return zh ? `聚落的土地${c.present ? "要" : "不能"}是${({ fertile: "沃土", river: "河邊", ruins: "廢墟", bunker: "地堡" } as Record<string, string>)[c.feature] ?? c.feature}` : `Settlement land must ${c.present ? "" : "not "}be ${c.feature}`;
    case "facility":
      return zh ? `${c.working ? "要有能用的" : "還沒有能用的"}${({ granary: "穀倉", well: "水井", clinic: "診所", forge: "鍛爐", schoolhouse: "校舍", palisade: "圍牆", watchtower: "瞭望塔", greenhouse: "溫室", meeting_hall: "議事廳" } as Record<string, string>)[c.facility]}` : `${c.working ? "Needs a working" : "Has no working"} ${c.facility}`;
    case "law":
      return zh ? `${c.active ? "正在實施" : "沒有實施"}「${({ rationing: "配給制", work_duty: "義務勞動", shared_stores: "公倉制", curfew: "宵禁" } as Record<string, string>)[c.law]}」` : `Law ${c.law} must ${c.active ? "" : "not "}be in force`;
    case "claims":
      return zh ? `聚落佔有的據點要${op(c.op)} ${c.value}` : `Claimed sites must be ${op(c.op)} ${c.value}`;
    case "site_claimed":
      return zh ? `「${term.locationName(c.location)}」${c.claimed ? "已經有人佔" : "還沒有人佔"}` : `${term.locationName(c.location)} must ${c.claimed ? "" : "not "}be claimed`;
    case "project":
      return zh ? `${c.active ? "正在" : "沒有在"}做「${term.techName(c.tech)}」` : `${term.techName(c.tech)} must ${c.active ? "" : "not "}be under way`;
    case "settlement_age":
      return zh ? `聚落建立 ${c.value} 年以上` : `Settlement at least ${c.value} years old`;
    case "tension":
      return zh ? `和鄰近聚落的緊張度要${op(c.op)} ${c.value}` : `Tension with a neighbour must be ${op(c.op)} ${c.value}`;
  }
}

/** Why an event cannot happen yet, using whichever place is closest to qualifying. */
/** Conditions that, once false, stay false: technologies, discoveries, secrets and past events are never undone. */
function irreversible(state: WorldState, c: Condition): boolean {
  switch (c.type) {
    case "technology": return !c.has && state.technologies.includes(c.tech);
    case "location": return !c.discovered && !!state.locations.find((l) => l.id === c.location)?.discovered;
    case "secret": return !c.revealed && !!state.secrets[c.secret];
    case "event_occurred": return !c.occurred && !c.withinTicks && (state.eventMemory.counts[c.event] ?? 0) > 0;
    default: return false;
  }
}

function needsFor(state: WorldState, def: EventDefinition, i18n: I18n): { ready: boolean; needs: string[]; never: boolean } {
  const zh = i18n.locale === "zh-TW";
  const report = checkEligibility(state, def);
  if (report.eligible) return { ready: true, needs: [], never: false };
  const count = state.eventMemory.counts[def.id] ?? 0;
  if (def.maxOccurrences !== null && count >= def.maxOccurrences) return { ready: false, needs: [zh ? "已經發生過了" : "Already happened"], never: true };
  if (def.preconditions.some((c) => irreversible(state, c))) return { ready: false, needs: [zh ? "世界已經走上別的路，這件事不會再發生" : "The world took another path; this can no longer happen"], never: true };
  if (report.blockedBy?.startsWith("On cooldown")) return { ready: false, needs: [zh ? "剛發生過，要隔幾年才會再來" : "Happened recently; needs a few years"], never: false };
  const anchors = def.scope === "world" ? [null] : activeSettlements(state);
  let best: string[] | null = null;
  for (const s of anchors) {
    const { traces } = evaluateAll(state, def.preconditions, { settlement: s });
    const failed = def.preconditions.filter((_, i) => !traces[i]?.passed).map((c) => plain(c, i18n));
    if (best === null || failed.length < best.length) best = failed;
  }
  if (best && best.length > 0) return { ready: false, needs: best, never: false };
  return { ready: false, needs: [report.blockedBy?.includes("roles") ? (zh ? "目前沒有合適的人選" : "Nobody suitable right now") : zh ? "目前條件還不夠" : "Not possible yet"], never: false };
}

export function buildStory(runId: string, state: WorldState, overrides: Record<string, string>, i18n: I18n): StoryLine[] {
  const content = getRunContent(db(), runId);
  const defs = new Map(content.events.map((e) => [e.id, e]));
  return content.storylines.map((line) => {
    const history = queryHistory(db(), runId, { storylineId: line.id, kind: "narrative", order: "asc", limit: 200 }).items;
    let seenNext = false;
    const beats = line.beats.map((b): StoryBeat => {
      const happened = history
        .filter((h) => h.definitionId && b.eventIds.includes(h.definitionId))
        .map((h) => ({ historyId: h.id, year: h.year, title: h.title, choice: h.choice?.label ?? null }));
      const done = b.eventIds.some((id) => (state.eventMemory.counts[id] ?? 0) > 0);
      const events = b.eventIds
        .map((id) => defs.get(id))
        .filter((d): d is EventDefinition => !!d)
        .map((d): StoryEvent => ({
          id: d.id,
          title: d.title,
          ...needsFor(state, d, i18n),
          chance: d.chance,
          choices: d.choices.map((c) => ({ id: c.id, label: c.label, description: c.description ?? null, tags: c.tags })),
          override: overrides[d.id] ?? null,
          personal: d.roles.some((r) => r.player) || d.participation === "everyone",
        }));
      const missed = !done && events.length > 0 && events.every((e) => e.never);
      const status: StoryBeat["status"] = done ? "done" : missed ? "missed" : seenNext ? "later" : "next";
      if (status === "next") seenNext = true;
      return { id: b.id, title: b.title, description: b.description, status, happened, events };
    });
    return {
      id: line.id,
      title: line.title,
      summary: line.summary,
      done: beats.filter((b) => b.status === "done").length,
      total: beats.filter((b) => b.status !== "missed").length,
      beats,
      outcomes: line.possibleOutcomes,
    };
  });
}

export interface DirectionOptions {
  policy: string;
  policies: { id: string; name: string; description: string }[];
  research: { id: string; name: string; description: string; current: boolean }[];
  found: { locationId: string; name: string; fromId: string; fromName: string; possible: boolean; reason: string | null }[];
  expeditionFrom: { id: string; name: string } | null;
}

/** The handful of big decisions the Studio can make for the world, in plain terms. */
export function directionOptions(state: WorldState, i18n: I18n): DirectionOptions {
  const { term } = i18n;
  const zh = i18n.locale === "zh-TW";
  const settlements = activeSettlements(state);
  const biggest = [...settlements].sort((a, b) => b.resources.materials - a.resources.materials)[0];
  return {
    policy: state.policy,
    policies: POLICIES.map((id) => ({ id, name: term.policyName(id), description: term.policyDescription(id) })),
    research: TECHNOLOGIES.filter((x) => !state.technologies.includes(x.id) && x.prerequisites.every((p) => state.technologies.includes(p))).map((x) => ({
      id: x.id,
      name: term.techName(x.id),
      description: term.techEffect(x.id),
      current: state.researchFocus === x.id,
    })),
    found: state.locations
      .filter((l) => l.discovered && !l.settlementId && LOCATION_BY_ID[l.id]?.settleable)
      .map((l) => ({
        locationId: l.id,
        name: term.locationName(l.id),
        fromId: biggest?.id ?? "",
        fromName: biggest?.name ?? "",
        possible: !!biggest && biggest.resources.materials >= FOUNDING_MATERIALS,
        reason: biggest && biggest.resources.materials >= FOUNDING_MATERIALS ? null : zh ? `需要 ${FOUNDING_MATERIALS} 份物資` : `Needs ${FOUNDING_MATERIALS} materials`,
      })),
    expeditionFrom: biggest ? { id: biggest.id, name: biggest.name } : null,
  };
}
