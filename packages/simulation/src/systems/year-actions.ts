import { ADULT_AGE, type AttributeId as Attribute, type Character, type PlayerAction, type ResourceId, type StateChange, type WorldState } from "@genesis/schemas";
import { characterAge, fullName, getCharacter, getSettlement, isZh, relationshipKey, residents, resourceName } from "@genesis/narrative";
import type { TickContext } from "../context";

type YearAction = Extract<PlayerAction, { type: "YEAR_ACTION" }>;

/** Minimum age for each activity. */
export const YEAR_ACTION_MIN_AGE = { scavenge: 14, work: 10, study: 0, visit: 0, rest: 0 } as const;

/**
 * The yearly activity: something every player can do every year, with an
 * immediate, visible result. Small numbers on purpose: a year of choices
 * should matter over a lifetime, not swing the world in one tap.
 */
export function validateYearAction(st: WorldState, me: Character | undefined, a: YearAction, alreadyActed: boolean): string | null {
  if (!me) return "You have no living character";
  if (alreadyActed) return "You have already spent this year";
  const age = characterAge(st, me);
  if (age < YEAR_ACTION_MIN_AGE[a.action]) return `You are too young for that (${YEAR_ACTION_MIN_AGE[a.action]}+)`;
  if ((a.action === "study" || a.action === "rest") && !me.attributes) return "This world has no attributes to train";
  if (a.action === "visit") {
    if (!a.characterId) return "Choose who to spend time with";
    const other = getCharacter(st, a.characterId);
    if (!other || other.deathTick !== null) return "That person is not alive";
    if (other.id === me.id) return "Choose someone else";
    if (other.homeId !== me.homeId) return `${fullName(other)} lives elsewhere`;
  }
  return null;
}

const attr = (c: Character, k: Attribute) => c.attributes?.[k] ?? 50;

export function applyYearAction(ctx: TickContext, me: Character, a: YearAction): { title: string; text: string } {
  const st = ctx.state;
  const zh = isZh(st);
  const home = getSettlement(st, me.homeId)!;
  const name = fullName(me);
  const changes: StateChange[] = [];
  const others: Character[] = [];

  const adjustAttr = (k: Attribute, delta: number) => {
    if (!me.attributes || delta === 0) return;
    const before = me.attributes[k];
    me.attributes[k] = Math.max(0, Math.min(100, before + delta));
    changes.push({ path: `characters.${me.id}.attributes.${k}`, label: `${name} ${k}`, before, after: me.attributes[k] });
  };
  const addResource = (r: ResourceId, amount: number) => {
    const before = home.resources[r];
    home.resources[r] = Math.round((before + amount) * 100) / 100;
    changes.push({ path: `settlements.${home.id}.resources.${r}`, label: `${home.name} ${r}`, before, after: home.resources[r] });
  };
  /** Positive time together grows faster between sociable people (same rule as event bonds). */
  const bond = (other: Character, base: number) => {
    const key = relationshipKey(me.id, other.id);
    const before = st.relationships[key] ?? 0;
    const scale = me.attributes ? 0.6 + attr(me, "social") / 250 + attr(other, "social") / 250 : 1;
    st.relationships[key] = Math.max(-100, Math.min(100, Math.round(before + base * scale)));
    changes.push({ path: `relationships.${key}`, label: `${name} ↔ ${fullName(other)}`, before, after: st.relationships[key]! });
    others.push(other);
    return st.relationships[key]! - before;
  };
  const neighbours = residents(st, home.id).filter((c) => c.id !== me.id);
  const adults = neighbours.filter((c) => characterAge(st, c) >= ADULT_AGE);

  let title: string;
  let text: string;
  switch (a.action) {
    case "scavenge": {
      const survival = attr(me, "survival");
      const hurtChance = Math.max(0.05, 0.3 - survival / 400);
      if (ctx.rng.chance(hurtChance)) {
        adjustAttr("health", -ctx.rng.int(8, 15));
        adjustAttr("survival", 2);
        title = zh ? `${name}在廢墟裡受了傷` : `${name} was hurt in the ruins`;
        text = zh ? "一段生鏽的樓梯在腳下塌了。你拖著傷回到家，什麼也沒帶回來，但學到了教訓。" : "Rusted stairs gave way under you. You limped home empty-handed, but wiser.";
      } else if (ctx.rng.chance(0.4 + survival / 250)) {
        const big = ctx.rng.chance(0.15);
        const r: ResourceId = ctx.rng.chance(0.5) ? "materials" : "food";
        const n = big ? ctx.rng.int(5, 8) : ctx.rng.int(2, 4);
        addResource(r, n);
        adjustAttr("survival", 1);
        title = zh ? `${name}從廢墟帶回 ${n} 份${resourceName(st, r)}` : `${name} brought back ${n} ${r} from the ruins`;
        text = big
          ? zh ? "你找到一間沒被翻過的地下室。整個聚落都聽說了。" : "You found a cellar no one had touched. Everyone heard about it."
          : zh ? "一整天的翻找，換來一點點收穫。在這個世界，這已經很好了。" : "A whole day of digging for a little. In this world, that is good.";
      } else {
        adjustAttr("survival", 2);
        title = zh ? `${name}外出搜刮，空手而回` : `${name} came back from scavenging empty-handed`;
        text = zh ? "能拿的都被拿走了。但你記住了哪些路走得通。" : "Everything worth taking was gone. But you learned which routes are safe.";
      }
      break;
    }
    case "work": {
      const coworker = adults.length ? ctx.rng.pick(adults.filter((c) => c.profession === me.profession).length ? adults.filter((c) => c.profession === me.profession) : adults) : undefined;
      if (characterAge(st, me) < ADULT_AGE || !me.profession) {
        addResource("food", 1);
        if (coworker) bond(coworker, 4);
        title = zh ? `${name}幫忙聚落的雜事` : `${name} helped with chores`;
        text = coworker
          ? zh ? `你跟著${fullName(coworker)}做了一整年的雜事。他們開始把你當自己人。` : `You spent the year helping ${fullName(coworker)}. They started treating you as one of their own.`
          : zh ? "你做了一整年的雜事。" : "You spent the year on chores.";
      } else {
        let what: string;
        switch (me.profession) {
          case "Scout": addResource("food", 3); adjustAttr("survival", 1); what = zh ? "帶回 3 份食物" : "brought back 3 food"; break;
          case "Engineer": addResource("materials", 3); adjustAttr("knowledge", 1); what = zh ? "修好的東西換來 3 份廢料" : "salvaged 3 materials"; break;
          case "Scientist": addResource("knowledge", 3); adjustAttr("knowledge", 1); what = zh ? "整理出 3 份知識" : "recorded 3 knowledge"; break;
          case "Medic": {
            const before = home.health;
            home.health = Math.min(100, before + 2);
            changes.push({ path: `settlements.${home.id}.health`, label: `${home.name} health`, before, after: home.health });
            adjustAttr("social", 1);
            what = zh ? "讓聚落的健康提升了 2" : "raised the settlement's health by 2";
            break;
          }
        }
        if (coworker) bond(coworker, 3);
        title = zh ? `${name}為${home.name}加倍工作，${what}` : `${name} worked extra for ${home.name} and ${what}`;
        text = coworker
          ? zh ? `${fullName(coworker)}和你並肩做完了這些事。` : `${fullName(coworker)} worked alongside you.`
          : zh ? "你一個人做完了這些事。" : "You did it alone.";
      }
      break;
    }
    case "study": {
      const teachers = adults.filter((c) => c.profession === "Scientist" || attr(c, "knowledge") >= 60);
      const teacher = teachers.length ? ctx.rng.pick(teachers) : undefined;
      const young = characterAge(st, me) < ADULT_AGE ? 1 : 0;
      adjustAttr("knowledge", ctx.rng.int(3, 5) + young + (teacher ? 1 : 0));
      if (teacher) bond(teacher, 4);
      title = teacher
        ? zh ? `${name}跟著${fullName(teacher)}學習` : `${name} studied with ${fullName(teacher)}`
        : zh ? `${name}獨自翻讀舊紀錄` : `${name} studied the old records alone`;
      text = teacher
        ? zh ? "很多事情比想像中難，但你開始看懂那些圖了。" : "It was harder than you expected, but the diagrams began to make sense."
        : zh ? "沒有人可以問，你只能一頁一頁慢慢讀。" : "With no one to ask, you went page by page.";
      break;
    }
    case "visit": {
      const other = getCharacter(st, a.characterId!)!;
      const close = ctx.rng.chance(0.15 + attr(me, "social") / 500);
      const gained = bond(other, close ? 10 : ctx.rng.int(4, 7));
      adjustAttr("social", 1);
      title = close
        ? zh ? `${name}和${fullName(other)}說了心裡話` : `${name} and ${fullName(other)} talked late into the night`
        : zh ? `${name}花時間陪${fullName(other)}` : `${name} spent time with ${fullName(other)}`;
      text = close
        ? zh ? `那天你們聊到很晚。有些話你從沒跟別人說過。（親密度 +${gained}）` : `Some things you had never told anyone. (bond +${gained})`
        : zh ? `日子很普通，但你們越來越熟了。（親密度 +${gained}）` : `Ordinary days, but you grew closer. (bond +${gained})`;
      break;
    }
    case "rest": {
      const hungry = home.shortage.food > 0 || home.shortage.water > 0;
      adjustAttr("health", hungry ? ctx.rng.int(1, 3) : ctx.rng.int(4, 7));
      title = zh ? `${name}這一年好好休養` : `${name} took the year to recover`;
      text = hungry
        ? zh ? "吃不飽的時候，休息也只能補回一點點。" : "Rest only helps so much when there is not enough to eat."
        : zh ? "睡得夠、吃得飽。身體記得這種感覺。" : "Enough sleep, enough food. Your body remembers.";
      break;
    }
  }

  const e = ctx.system({
    category: a.action === "scavenge" ? "exploration" : a.action === "visit" ? "social" : a.action === "rest" ? "health" : "resource",
    importance: "minor",
    title,
    text,
    scope: "character",
    settlementIds: [home.id],
    characterIds: [me.id, ...others.map((o) => o.id)],
    changes,
    summary: `Year action: ${a.action} (logged for replay)`,
  });
  me.lifeEvents.push({ tick: st.tick, text: title, historyId: e.id });
  for (const o of others) if (a.action === "visit") o.lifeEvents.push({ tick: st.tick, text: title, historyId: e.id });
  return { title, text };
}
