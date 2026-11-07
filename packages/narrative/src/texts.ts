import { BRANCH_INFO, LOCATION_BY_ID, TECH_BY_ID, ZH_CATALOG, type BranchId, type Profession, type ResourceId, type Settlement, type WorldState } from "@genesis/schemas";
import { currentYear, fullName, getCharacter, rivalOf } from "./queries";

/**
 * Text the engine writes into history and life stories, in the world's
 * locale. Worlds without a locale are English, so older runs replay exactly.
 */
export function isZh(state: Pick<WorldState, "locale">): boolean {
  return state.locale === "zh-TW";
}

export function placeName(state: Pick<WorldState, "locale">, locationId: string): string {
  if (isZh(state)) return (ZH_CATALOG.locationName as Record<string, string>)[locationId] ?? LOCATION_BY_ID[locationId]?.name ?? locationId;
  return LOCATION_BY_ID[locationId]?.name ?? locationId;
}

export function placeDescription(state: Pick<WorldState, "locale">, locationId: string): string {
  if (isZh(state)) return (ZH_CATALOG.locationDescription as Record<string, string>)[locationId] ?? "";
  return LOCATION_BY_ID[locationId]?.description ?? "";
}

export function professionName(state: Pick<WorldState, "locale">, p: Profession | null): string {
  if (p === null) return isZh(state) ? "少年" : "youth";
  return isZh(state) ? ZH_CATALOG.profession[p] : p;
}

export function resourceName(state: Pick<WorldState, "locale">, r: ResourceId): string {
  return isZh(state) ? ZH_CATALOG.resource[r] : r;
}

export function techText(state: Pick<WorldState, "locale">, id: string) {
  const t = TECH_BY_ID[id]!;
  if (!isZh(state)) return { name: t.name, description: t.description, effect: t.effect };
  const z = ZH_CATALOG as unknown as Record<"techName" | "techDescription" | "techEffect", Record<string, string>>;
  return { name: z.techName[id] ?? t.name, description: z.techDescription[id] ?? t.description, effect: z.techEffect[id] ?? t.effect };
}

export function branchName(state: Pick<WorldState, "locale">, b: BranchId): string {
  return isZh(state) ? ZH_CATALOG.branch[b] : BRANCH_INFO[b].name;
}

/** Join names the way the language does. */
export function listNames(state: Pick<WorldState, "locale">, names: readonly string[]): string {
  return names.join(isZh(state) ? "、" : ", ");
}

const opt = (v: string | undefined, en: (v: string) => string) => (v ? en(v) : "");

const EN = {
  bornHaven: () => "Born in Haven Deep (Vault 7)",
  openedDoor: (prof: string) => `Among the survivors who opened the Haven Deep blast door, working as a ${prof}`,
  reassigned: (prof: string) => `Reassigned to work as a ${prof}`,
  reliefTitle: (amount: number, r: string, to: string) => `Relief caravan: ${amount} ${r} to ${to}`,
  reliefText: (from: string, amount: number, r: string, to: string) => `${from} sends ${amount} ${r} to ease the shortage in ${to}.`,
  techTitle: (name: string) => `${name} rediscovered`,
  techBody: (name: string, desc: string, effect: string) => `After years of work, the survivors master ${name}. ${desc} Effect: ${effect}`,
  growTitle: (s: string, level: number) => `${s} grows to level ${level}`,
  growText: (s: string, cap: number) => `Engineers in ${s} raise new shelters and workshops. Capacity rises to ${cap}.`,
  discoverTitle: (place: string) => `${place} discovered`,
  discoverText: (scout: string, from: string, place: string, desc: string, settleable: boolean) =>
    `${scout}, scouting from ${from}, reaches ${place}. ${desc}${settleable ? " The site could support a settlement." : ""}`,
  discoveredLife: (place: string) => `Discovered ${place}`,
  shortageTitle: (r: "food" | "water", s: string) => `${r === "food" ? "Food" : "Water"} shortage in ${s}`,
  shortageText: (s: string, pct: number, r: string) => `${s} could not meet ${pct}% of its ${r} needs this year. Rationing begins; the weak and the young suffer first.`,
  recoverTitle: (s: string, r: string) => `${s} recovers from ${r} shortage`,
  recoverText: (years: number, s: string, r: string) => `After ${years} lean year(s), ${s} once again meets its ${r} needs.`,
  causeDehydration: () => "dehydration during the water shortage",
  causeStarvation: () => "starvation during the famine",
  causeLost: () => "lost in the wastes while scouting",
  causeOldAge: () => "old age",
  causeChildhood: () => "childhood illness",
  causesOther: () => ["fever", "infected wound", "a collapse in the ruins", "illness"],
  deathTitle: (name: string) => `Death of ${name}`,
  deathText: (name: string, prof: string | null, s: string, age: number, cause: string) => `${name}${prof ? `, ${prof.toLowerCase()}` : ""} of ${s}, died at age ${age} of ${cause}.`,
  diedLife: (age: number, cause: string) => `Died at ${age}: ${cause}`,
  diedEvent: (cause: string) => `Died: ${cause}`,
  birthTitle: (name: string) => `Birth of ${name}`,
  birthText: (child: string, s: string, a: string, b: string) => `${child} was born in ${s} to ${a} and ${b}.`,
  bornIn: (s: string) => `Born in ${s}`,
  childBorn: (given: string) => `Child ${given} born`,
  cameOfAge: (prof: string) => `Came of age and began training as a ${prof}`,
  foundTitle: (place: string) => `Founding of ${place}`,
  foundText: (n: number, from: string, place: string, desc: string) => `${n} people leave ${from} to build a new home at ${place}. ${desc}`,
  helpedFound: (place: string) => `Helped found ${place}`,
  silentTitle: (s: string) => `${s} falls silent`,
  silentText: (s: string) => `The last resident of ${s} is gone. Its shelters stand empty.`,
  lastTitle: () => "The last survivor dies",
  lastText: () => "Human civilization in the region has collapsed. The world continues without them.",
  popTitle: (m: number) => `Population reaches ${m}`,
  popText: (pop: number) => `For the first time since the collapse, ${pop} people live in the region.`,
  outpostStandsTitle: (s: string) => `${s} stands on its own`,
  outpostStandsText: (s: string, parent: string) => `${s} no longer needs supplies from ${parent}. The outpost is now a settlement of its own.`,
  wanderersTitle: (n: number, s: string) => `${n} wanderers arrive at ${s}`,
  wanderersText: (n: number, s: string) => `${n} people walked in from the wastes, thin and wary, and asked to stay. ${s} took them in.`,
  refugeesTitle: (s: string) => `Survivors from the wastes settle ${s}`,
  refugeesText: (s: string) => `No one was left to find them. A band of survivors from another shelter made camp at ${s} and began again.`,
  networkTitle: () => "A network of settlements",
  networkText: (n: number) => `${n} communities now trade, quarrel and share news.`,
  rebuildTitle: () => "The age of rebuilding is complete",
  rebuildText: () => "Every known technology of the bunker archives has been recovered.",
  allSettlements: () => "the settlements",
  decision: (label: string) => `Decision: ${label}.`,
  eachDecides: (players: string, others: number, year: number) => `Each participant decides for themselves (${players}${others > 0 ? ` and ${others} others` : ""}). Decisions are due by year ${year}.`,
  chose: (names: string, label: string) => `${names} chose: ${label}.`,
  lowerLevels: () => "Lived in the lower levels of Haven Deep",
  grewUp: (s: string) => `Grew up under the open sky in ${s}`,
  survivedWastes: () => "Survived alone in the wastes",
  walkedOutVault12: () => "Walked out of Vault 12",
  joinHaven: (n: string) => `${n} climbs up from the lower levels of Haven Deep`,
  joinSurface: (n: string, s: string) => `${n} comes of age in ${s}`,
  joinWanderer: (n: string, s: string) => `A wanderer, ${n}, arrives at ${s}`,
  joinVault12: (n: string, s: string) => `${n}, a survivor of Vault 12, reaches ${s}`,
  playedBy: (title: string, player: string) => `${title}. Played by ${player}.`,
  stepsForward: (n: string) => `${n} steps forward`,
  takeover: (n: string, player: string) => `${n} of Haven Deep is now played by ${player}.`,
  answersCall: (c: string, inviter: string) => `${c} answers ${inviter}'s call`,
  answersText: (c: string, inviter: string) => `A new player now lives the life of ${c}, invited by ${inviter}.`,
  carriesOn: (c: string) => `${c} carries on`,
  tie: (kind: "child" | "ward" | "companion"): string => kind,
  carriesText: (player: string, c: string, tie: string, last: string | undefined) => `${player}'s story continues through ${c}${last ? `, ${tie} of ${last}` : ""}.`,
  newLife: (c: string) => `A new life: ${c}`,
  rebornText: (player: string, c: string, place: string) => `${player} is reborn as ${c}, a child of ${place}.`,
  babyText: (baby: string, home: string, parents: string, player: string) => `${baby} is born in ${home}${parents ? ` to ${parents}` : ""}. ${player} begins a new life.`,
  careAdoptTitle: (me: string, t: string) => `${me} takes in ${t}`,
  careTitle: (me: string, t: string) => `${me} looks after ${t}`,
  careAdoptText: (me: string, t: string) => `${me} takes ${t} under their roof.`,
  careText: (me: string, t: string) => `${me} has begun caring for ${t}.`,
  inviteBorn: (baby: string) => `${baby} is born`,
  inviteBornText: (inviter: string, baby: string, player: string) => `${inviter}'s child ${baby} is born, played by ${player}.`,
  climbTitle: (me: string, partner?: string) => `${me} climbs into daylight${opt(partner, (p) => ` with ${p}`)}`,
  climbText: () => "The first sight of the open sky in a lifetime: ash-grey, enormous, and quiet.",
  repairTitle: (me: string, partner?: string) => `${me} helps patch the reclaimers${opt(partner, (p) => ` with ${p}`)}`,
  repairText: () => "A cracked filter housing, two pairs of hands, and a little more clean water for everyone.",
  shareTitle: (me: string, other?: string) => `${me} shares water${opt(other, (p) => ` with ${p}`)}`,
  shareText: () => "Half a cup, given without being asked twice. It will be remembered.",
  refuseTitle: (me: string, other?: string) => `${me} refuses${opt(other, (p) => ` ${p}`)} a drink`,
  refuseText: () => "Rations are rations. It will be remembered too.",
  tellTitle: (me: string) => `${me} speaks of a voice in the static`,
  tellText: () => "Most laugh it off. A few lean closer and ask what it said.",
  keptStatic: () => "Heard a voice in the radio static and told no one",
  renamed: (before: string, after: string) => `${before} now goes by ${after}`,
  raidTitle: (raider: string, victim: string) => `${raider} raids ${victim}`,
  raidText: (leader: string, raider: string, victim: string, n: number, r: string) => `Out of patience, people from ${raider} led by ${leader} broke into ${victim}'s stores and carried off ${n} ${r}.`,
  raidLife: (victim: string) => `Led a raid on ${victim}`,
  causeRaid: () => "killed in a raid",
  aidRefusedTitle: (donor: string, needy: string) => `${donor} refuses to help ${needy}`,
  aidRefusedText: (donor: string, needy: string, r: string) => `${needy} is running out of ${r}. ${donor} has enough to spare, but after everything between them, its council says no.`,
  schismTitle: (s: string) => `${s} splits`,
  schismCrowded: () => "there was no room left to live",
  schismUnhappy: () => "too many had stopped believing in the council",
  schismText: (leader: string, s: string, n: number, why: string) => `In ${s}, ${why}. ${leader} and ${n} others packed what they could carry and walked out to build somewhere of their own.`,
  schismMoveText: (leader: string, s: string, n: number, dest: string, why: string) => `In ${s}, ${why}. ${leader} led ${n} people away to ${dest}.`,
  schismLife: (s: string) => `Left ${s} after the split`,
  projectStartTitle: (lead: string, tech: string) => `${lead} starts work on ${tech}`,
  projectStartCouncil: (lead: string, tech: string, place: string) => `The council asks ${lead} to lead work on ${tech} in ${place}. Anyone who can help is welcome.`,
  projectStartPlayer: (lead: string, tech: string, place: string) => `${lead} calls on ${place} to build ${tech} together.`,
  projectStartedLife: (tech: string) => `Started work on ${tech}`,
  projectJoinedLife: (tech: string) => `Joined the work on ${tech}`,
  projectSetbackTitle: (tech: string) => `Setback on ${tech}`,
  projectSetbackText: (who: string, tech: string, place: string, variant: number) =>
    [`Part of the work ${who} was responsible for failed. ${tech} in ${place} slips back.`, `A storm, a bad batch, a wrong measurement. ${who} and the others in ${place} lose months of work on ${tech}.`, `An argument over how to do it properly stops work on ${tech} in ${place}. ${who} gets it going again, but time is lost.`][variant % 3]!,
  projectBreakthroughTitle: (tech: string) => `Breakthrough on ${tech}`,
  projectBreakthroughText: (who: string, tech: string) => `${who} works out what had everyone stuck. ${tech} leaps forward.`,
  projectStalledTitle: (tech: string) => `${tech} is set aside`,
  projectStalledText: (tech: string, place: string) => `No one in ${place} has worked on ${tech} for years. The tools go back in their crates for whoever comes next.`,
  projectDoneTitle: (tech: string, place: string) => `${place} completes ${tech}`,
  projectDoneText: (lead: string, n: number, tech: string, desc: string, effect: string) => `Led by ${lead}, ${n} people finished ${tech}. ${desc} Effect: ${effect}`,
  ledProject: (tech: string) => `Led the work that completed ${tech}`,
  workedProject: (tech: string) => `Helped complete ${tech}`,
};

const ZH: typeof EN = {
  bornHaven: () => "生於深港地堡（第七號避難所）",
  openedDoor: (prof) => `打開深港地堡防爆門的倖存者之一，擔任${prof}`,
  reassigned: (prof) => `改任${prof}`,
  reliefTitle: (amount, r, to) => `救援商隊：運送 ${amount} ${r}到${to}`,
  reliefText: (from, amount, r, to) => `${from}送出 ${amount} ${r}，緩解${to}的短缺。`,
  techTitle: (name) => `重新掌握${name}`,
  techBody: (name, desc, effect) => `經過多年努力，倖存者終於掌握了${name}。${desc}效果：${effect}`,
  growTitle: (s, level) => `${s}擴建到第 ${level} 級`,
  growText: (s, cap) => `${s}的工程師蓋起新的住所和工坊，可容納人數提升到 ${cap} 人。`,
  discoverTitle: (place) => `發現${place}`,
  discoverText: (scout, from, place, desc, settleable) => `${scout}從${from}出發偵察，抵達了${place}。${desc}${settleable ? "這裡可以建立聚落。" : ""}`,
  discoveredLife: (place) => `發現了${place}`,
  shortageTitle: (r, s) => `${s}陷入${r === "food" ? "糧食" : "水"}短缺`,
  shortageText: (s, pct, r) => `${s}今年有 ${pct}% 的${r}需求無法滿足。開始配給，最虛弱的人和孩子最先受苦。`,
  recoverTitle: (s, r) => `${s}走出${r}短缺`,
  recoverText: (years, s, r) => `熬過 ${years} 個艱困的年頭後，${s}的${r}終於又夠用了。`,
  causeDehydration: () => "缺水期間脫水",
  causeStarvation: () => "饑荒中餓死",
  causeLost: () => "偵察時迷失在荒野",
  causeOldAge: () => "年老",
  causeChildhood: () => "幼年病逝",
  causesOther: () => ["熱病", "傷口感染", "廢墟坍塌", "疾病"],
  deathTitle: (name) => `${name}過世`,
  deathText: (name, prof, s, age, cause) => `${s}的${prof ?? ""}${name}過世，享年 ${age} 歲，死因：${cause}。`,
  diedLife: (age, cause) => `${age} 歲過世：${cause}`,
  diedEvent: (cause) => `過世：${cause}`,
  birthTitle: (name) => `${name}出生`,
  birthText: (child, s, a, b) => `${child}在${s}出生，父母是${a}和${b}。`,
  bornIn: (s) => `生於${s}`,
  childBorn: (given) => `孩子${given}出生`,
  cameOfAge: (prof) => `成年，開始學習成為${prof}`,
  foundTitle: (place) => `建立${place}`,
  foundText: (n, from, place, desc) => `${n} 人離開${from}，到${place}建立新家園。${desc}`,
  helpedFound: (place) => `參與建立${place}`,
  silentTitle: (s) => `${s}陷入沉寂`,
  silentText: (s) => `${s}的最後一位居民也不在了。屋舍空無一人。`,
  lastTitle: () => "最後的倖存者死去",
  lastText: () => "這片土地上的人類文明崩潰了。世界在沒有他們的情況下繼續運轉。",
  popTitle: (m) => `人口達到 ${m}`,
  popText: (pop) => `自崩潰以來，第一次有 ${pop} 人生活在這片土地上。`,
  outpostStandsTitle: (s) => `${s}自立了`,
  outpostStandsText: (s, parent) => `${s}不再需要${parent}的補給。這個前哨站，如今是一個獨立的聚落。`,
  wanderersTitle: (n, s) => `${n} 個流浪者來到${s}`,
  wanderersText: (n, s) => `${n} 個人從荒野走來，又瘦又警覺，請求留下。${s}收留了他們。`,
  refugeesTitle: (s) => `荒野的倖存者在${s}落腳`,
  refugeesText: (s) => `已經沒有人能收留他們了。一群來自別處避難所的倖存者在${s}紮營，重新開始。`,
  networkTitle: () => "聚落網絡成形",
  networkText: (n) => `${n} 個社群如今彼此交易、爭吵、互通消息。`,
  rebuildTitle: () => "重建時代完成",
  rebuildText: () => "地堡檔案裡的每一項已知科技都已找回。",
  allSettlements: () => "各聚落",
  decision: (label) => `決定：${label}。`,
  eachDecides: (players, others, year) => `每個參與者自己決定（${players}${others > 0 ? `，以及另外 ${others} 人` : ""}）。必須在 ${year} 年前做出決定。`,
  chose: (names, label) => `${names}選擇了：${label}。`,
  lowerLevels: () => "住在深港地堡的下層",
  grewUp: (s) => `在${s}的露天下長大`,
  survivedWastes: () => "獨自在荒野中活了下來",
  walkedOutVault12: () => "從第十二號避難所走了出來",
  joinHaven: (n) => `${n}從深港地堡的下層爬了上來`,
  joinSurface: (n, s) => `${n}在${s}成年`,
  joinWanderer: (n, s) => `流浪者${n}來到${s}`,
  joinVault12: (n, s) => `第十二號避難所的倖存者${n}抵達${s}`,
  playedBy: (title, player) => `${title}。由 ${player} 操作。`,
  stepsForward: (n) => `${n}挺身而出`,
  takeover: (n, player) => `深港地堡的${n}現在由 ${player} 操作。`,
  answersCall: (c, inviter) => `${c}回應了${inviter}的邀請`,
  answersText: (c, inviter) => `一位新玩家開始過${c}的人生，受${inviter}邀請。`,
  carriesOn: (c) => `${c}接續下去`,
  tie: (kind) => ({ child: "孩子", ward: "照顧的人", companion: "摯友" })[kind],
  carriesText: (player, c, tie, last) => `${player} 的故事由${c}延續${last ? `，${c}是${last}的${tie}` : ""}。`,
  newLife: (c) => `新的人生：${c}`,
  rebornText: (player, c, place) => `${player} 重生為${place}的孩子${c}。`,
  babyText: (baby, home, parents, player) => `${baby}在${home}出生${parents ? `，父母是${parents}` : ""}。${player} 開始新的人生。`,
  careAdoptTitle: (me, t) => `${me}收留了${t}`,
  careTitle: (me, t) => `${me}開始照顧${t}`,
  careAdoptText: (me, t) => `${me}讓${t}住進自己家。`,
  careText: (me, t) => `${me}開始照顧${t}。`,
  inviteBorn: (baby) => `${baby}出生`,
  inviteBornText: (inviter, baby, player) => `${inviter}的孩子${baby}出生了，由 ${player} 操作。`,
  climbTitle: (me, partner) => `${me}${partner ? `和${partner}一起` : ""}爬進日光裡`,
  climbText: () => "一生中第一次看見開闊的天空：灰濛濛的、巨大，而且安靜。",
  repairTitle: (me, partner) => `${me}${partner ? `和${partner}一起` : ""}修補濾水機`,
  repairText: () => "一個破裂的濾水槽、兩雙手，大家多了一點乾淨的水。",
  shareTitle: (me, other) => `${me}把水分給${other ?? "別人"}`,
  shareText: () => "半杯水，對方不必開口第二次。這會被記住的。",
  refuseTitle: (me, other) => `${me}拒絕分水給${other ?? "別人"}`,
  refuseText: () => "配給就是配給。這也會被記住的。",
  tellTitle: (me) => `${me}說起雜訊裡的聲音`,
  tellText: () => "大多數人笑笑就算了。有幾個人湊過來，問它說了什麼。",
  keptStatic: () => "聽見收音機雜訊裡的人聲，沒有告訴任何人",
  renamed: (before, after) => `${before}改名為${after}`,
  raidTitle: (raider, victim) => `${raider}搶了${victim}`,
  raidText: (leader, raider, victim, n, r) => `忍無可忍的${raider}居民，在${leader}帶頭下闖進${victim}的倉庫，搬走了 ${n} 份${r}。`,
  raidLife: (victim) => `帶頭搶了${victim}`,
  causeRaid: () => "死於一場搶糧",
  aidRefusedTitle: (donor, needy) => `${donor}拒絕援助${needy}`,
  aidRefusedText: (donor, needy, r) => `${needy}的${r}快見底了。${donor}明明有餘，但兩邊積怨太深，議會一口回絕。`,
  schismTitle: (s) => `${s}分裂了`,
  schismCrowded: () => "擠到再也住不下",
  schismUnhappy: () => "太多人已經不再相信議會",
  schismText: (leader, s, n, why) => `${s}${why}。${leader}和另外 ${n} 個人帶著搬得動的東西出走，要去建一個自己的地方。`,
  schismMoveText: (leader, s, n, dest, why) => `${s}${why}。${leader}帶著 ${n} 個人離開，投奔${dest}。`,
  schismLife: (s) => `在分裂後離開了${s}`,
  projectStartTitle: (lead, tech) => `${lead}發起「${tech}」`,
  projectStartCouncil: (lead, tech, place) => `議會請${lead}在${place}帶頭推動「${tech}」。願意幫忙的人都可以加入。`,
  projectStartPlayer: (lead, tech, place) => `${lead}號召${place}的人一起做「${tech}」。`,
  projectStartedLife: (tech) => `發起了「${tech}」`,
  projectJoinedLife: (tech) => `加入了「${tech}」`,
  projectSetbackTitle: (tech) => `「${tech}」出了差錯`,
  projectSetbackText: (who, tech, place, variant) =>
    [`${who}負責的那一段出了問題，${place}的「${tech}」倒退了一截。`, `一場暴風、一批壞掉的材料、一次量錯的尺寸。${who}和${place}的其他人在「${tech}」上白做了好幾個月。`, `大家為了怎樣才算做對吵了起來，${place}的「${tech}」停工了。${who}讓工作重新動起來，但時間已經耽誤了。`][variant % 3]!,
  projectBreakthroughTitle: (tech) => `「${tech}」有了突破`,
  projectBreakthroughText: (who, tech) => `${who}想通了卡住大家很久的地方，「${tech}」一下子往前跳了一大步。`,
  projectStalledTitle: (tech) => `「${tech}」被擱置了`,
  projectStalledText: (tech, place) => `${place}已經好幾年沒人在做「${tech}」了。工具收回箱子裡，留給以後的人。`,
  projectDoneTitle: (tech, place) => `${place}完成了「${tech}」`,
  projectDoneText: (lead, n, tech, desc, effect) => `在${lead}的帶領下，${n} 個人完成了「${tech}」。${desc}效果：${effect}`,
  ledProject: (tech) => `帶領大家完成了「${tech}」`,
  workedProject: (tech) => `參與完成了「${tech}」`,
};

export type TextKey = keyof typeof EN;

/** The engine's phrasebook for this world. Usage: `say(state).deathTitle(name)`. */
export function say(state: Pick<WorldState, "locale">): typeof EN {
  return isZh(state) ? ZH : EN;
}

/** Values for {{placeholders}} in authored text, in the world's language. */
export function templateValues(state: WorldState, settlement: Settlement | null, roles: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {
    settlement: settlement?.name ?? say(state).allSettlements(),
    rival: (settlement && rivalOf(state, settlement)?.name) || say(state).allSettlements(),
    year: String(currentYear(state)),
    world: state.worldName,
  };
  for (const [role, id] of Object.entries(roles)) {
    const c = getCharacter(state, id);
    if (c) {
      values[role] = fullName(c);
      values[`${role}.profession`] = professionName(state, c.profession);
    }
  }
  return values;
}

