import Link from "next/link";
import { Building2, Clock, Globe2, Lock, MapPin, Unlock } from "lucide-react";
import { BRANCHES, BRANCH_INFO, LOCATION_BY_ID, PROFESSIONS, RESOURCES, SECRET_BY_ID, TECHNOLOGIES, Rng, type WorldState } from "@genesis/schemas";
import { characterAge, fullName, population, residents } from "@genesis/narrative";
import { TickContext, currentResearchTarget, developmentCost } from "@genesis/simulation";
import { reconstructState } from "@genesis/database";
import { Card, CardHeader, EmptyState, KeyValue, LinkButton, PageHeader, Pill, ProgressBar, Tabs, buttonClass } from "@/components/ui";
import { RESOURCE_META } from "@/lib/resource-meta";
import { db, loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("world.title") };
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function WorldPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const run = loadActiveRun();
  if (!run) return <EmptyState icon={<Globe2 />} title={t("common.noActiveRun")} action={<LinkButton href="/simulate" variant="primary">{t("common.createRun")}</LinkButton>} />;

  const tab = one(sp.tab) ?? "settlements";
  const requested = one(sp.tick);
  let state: WorldState = run.state;
  let replayInfo: string | null = null;
  let tickError: string | null = null;
  if (requested !== undefined && /^\d+$/.test(requested) && Number(requested) !== run.state.tick) {
    try {
      const r = reconstructState(db(), run.summary.id, Number(requested));
      state = r.state;
      replayInfo = t("world.reconstructed", { snapshot: r.fromSnapshot, ticks: r.replayedTicks });
    } catch (err) {
      tickError = (err as Error).message;
    }
  }
  const past = state.tick !== run.state.tick;
  const tickParam = past ? `&tick=${state.tick}` : "";
  const alive = state.characters.filter((c) => c.deathTick === null);

  return (
    <div>
      <PageHeader eyebrow={run.summary.name} title={t("world.title")} description={t("world.description")} />

      <Card className="mb-4">
        <form method="get" action="/world" className="flex flex-wrap items-end gap-2 p-3">
          <input type="hidden" name="tab" value={tab} />
          <label className="min-w-0 flex-1">
            <span className="label-xs flex items-center gap-1"><Clock size={12} /> {t("world.inspectTick", { max: run.state.tick })}</span>
            <input className="field num mt-1" name="tick" type="number" min={0} max={run.state.tick} defaultValue={state.tick} />
          </label>
          <button className={buttonClass("secondary")} type="submit">{t("world.travel")}</button>
          {past && <Link className={buttonClass("ghost")} href={`/world?tab=${tab}`}>{t("world.present")}</Link>}
        </form>
        {(replayInfo || tickError) && (
          <p className={`border-t border-line px-3 py-2 text-[12px] ${tickError ? "text-danger" : "text-water"}`}>{tickError ?? replayInfo} {past && <strong>{t("world.viewingYear", { year: state.startYear + state.tick })}</strong>}</p>
        )}
      </Card>

      <Tabs
        active={tab}
        items={[
          { key: "settlements", label: t("overview.settlements"), href: `/world?tab=settlements${tickParam}`, count: state.settlements.length },
          { key: "people", label: t("world.people"), href: `/world?tab=people${tickParam}`, count: alive.length },
          { key: "tech", label: t("overview.technology"), href: `/world?tab=tech${tickParam}`, count: state.technologies.length },
          { key: "world", label: t("world.flagsMap"), href: `/world?tab=world${tickParam}` },
        ]}
      />

      {tab === "settlements" && <Settlements state={state} />}
      {tab === "people" && <People state={state} sp={sp} tickParam={tickParam} />}
      {tab === "tech" && <Tech state={state} />}
      {tab === "world" && <WorldFlags state={state} />}
    </div>
  );
}

async function Settlements({ state }: { state: WorldState }) {
  const { t, term } = await getI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {state.settlements.map((s) => {
        const people = residents(state, s.id);
        const pop = people.length;
        return (
          <Card key={s.id}>
            <Link href={`/world/settlements/${s.id}`} className="block p-4 hover:bg-surface-2/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Building2 size={16} className="text-signal" /><h3 className="truncate font-semibold">{s.name}</h3></div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{term.settlementKind(s.kind === "bunker" ? "bunker" : "surface")} · {t("world.level", { n: s.level })} · {t("world.founded", { year: state.startYear + s.foundedTick })}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {s.status === "abandoned" ? <Pill tone="danger">{term.status("abandoned")}</Pill> : <Pill tone="ok">{term.status("active")}</Pill>}
                  {(s.shortage.food > 0 || s.shortage.water > 0) && <Pill tone="warn">{t("world.shortage")}</Pill>}
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[12px] text-ink-3"><span>{t("overview.population")}</span><span className="num">{pop}/{s.capacity}</span></div>
                <ProgressBar value={pop} max={s.capacity} color={pop > s.capacity ? "bg-danger" : "bg-signal"} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                {RESOURCES.map((r) => {
                  const M = RESOURCE_META[r];
                  return <div key={r} className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-ink-3"><M.icon size={13} className={M.text} />{term.resource(r)}</span><span className="num">{Math.round(s.resources[r])}</span></div>;
                })}
                <div className="flex items-center justify-between"><span className="text-ink-3">{t("world.morale")}</span><span className="num">{Math.round(s.morale)}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink-3">{t("world.health")}</span><span className="num">{Math.round(s.health)}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {PROFESSIONS.map((p) => {
                  const n = people.filter((c) => c.profession === p).length;
                  return <Pill key={p}>{term.profession(p)} {n}</Pill>;
                })}
                <Pill>{term.profession(null)} {people.filter((c) => c.profession === null).length}</Pill>
              </div>
              {s.status === "active" && s.level < (s.kind === "bunker" ? 3 : 5) && <div className="mt-2 text-[12px] text-ink-3">{t("world.nextLevel", { cost: developmentCost(s) + 10 })}</div>}
            </Link>
          </Card>
        );
      })}
    </div>
  );
}

async function People({ state, sp, tickParam }: { state: WorldState; sp: SP; tickParam: string }) {
  const { t, term } = await getI18n();
  const status = one(sp.status) ?? "alive";
  const profession = one(sp.profession);
  const settlement = one(sp.settlement);
  const q = one(sp.q)?.toLowerCase();
  const list = state.characters
    .filter((c) => (status === "all" ? true : status === "dead" ? c.deathTick !== null : c.deathTick === null))
    .filter((c) => !profession || (profession === "youth" ? c.profession === null : c.profession === profession))
    .filter((c) => !settlement || c.homeId === settlement)
    .filter((c) => !q || fullName(c).toLowerCase().includes(q))
    .sort((a, b) => a.birthTick - b.birthTick);
  const shown = list.slice(0, 150);
  const settlementName = (id: string) => state.settlements.find((s) => s.id === id)?.name ?? id;
  return (
    <>
      <form method="get" action="/world" className="card mb-3 grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
        <input type="hidden" name="tab" value="people" />
        {tickParam && <input type="hidden" name="tick" value={state.tick} />}
        <input className="field col-span-2 sm:col-span-1" name="q" placeholder={t("world.searchName")} defaultValue={one(sp.q)} />
        <select className="field" name="status" defaultValue={status}><option value="alive">{t("world.alive")}</option><option value="dead">{t("world.deceased")}</option><option value="all">{t("common.all")}</option></select>
        <select className="field" name="profession" defaultValue={profession ?? ""}><option value="">{t("world.allRoles")}</option>{PROFESSIONS.map((p) => <option key={p} value={p}>{term.profession(p)}</option>)}<option value="youth">{term.profession(null)}</option></select>
        <select className="field" name="settlement" defaultValue={settlement ?? ""}><option value="">{t("world.allHomes")}</option>{state.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className={buttonClass("secondary")} type="submit">{t("world.filter")}</button>
      </form>
      <div className="mb-2 text-xs text-ink-3">{t("world.peopleCount", { count: list.length })}{list.length > shown.length ? ` ${t("world.showing", { n: shown.length })}` : ""}</div>
      {shown.length === 0 ? <EmptyState title={t("world.nobody")} /> : (
        <Card>
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id}>
                <Link href={`/world/characters/${c.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2/50">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold ${c.deathTick === null ? "border-line-strong bg-surface-3 text-ink-2" : "border-line text-ink-3"}`}>
                    {c.givenName[0]}{c.familyName[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${c.deathTick !== null ? "text-ink-3" : ""}`}>{fullName(c)} {c.deathTick !== null && "†"}</div>
                    <div className="truncate text-[12px] text-ink-3">{term.profession(c.profession)} · {settlementName(c.homeId)} · {t("world.born", { year: state.startYear + c.birthTick })}</div>
                  </div>
                  <span className="num shrink-0 text-sm text-ink-2">{characterAge(state, c)}<span className="text-ink-3">{t("world.yearsShort")}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

async function Tech({ state }: { state: WorldState }) {
  const { t, term } = await getI18n();
  const target = currentResearchTarget(new TickContext(structuredClone(state), new Rng(0)));
  const projects = new Map((state.projects ?? []).map((p) => [p.techId, p]));
  return (
    <div className="space-y-5">
      {BRANCHES.map((branch) => (
        <section key={branch}>
          <h3 className="label-xs mb-2">{term.branch(branch)} · {term.profession(BRANCH_INFO[branch].profession)}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TECHNOLOGIES.filter((x) => x.branch === branch).map((tech) => {
              const has = state.technologies.includes(tech.id);
              const ready = !has && tech.prerequisites.every((p) => state.technologies.includes(p));
              const popBlocked = tech.minPopulation && population(state) < tech.minPopulation;
              const project = projects.get(tech.id);
              return (
                <Card key={tech.id} className={has ? "border-knowledge/40" : project ? "border-signal/40" : ""}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold"><span className="num mr-1 text-xs text-ink-3">{tech.tier}</span>{term.techName(tech.id)}</h4>
                      {has ? <Pill tone="knowledge"><Unlock size={11} /> {state.startYear + (state.techUnlockedAt[tech.id] ?? 0)}</Pill>
                        : project ? <Pill tone="signal">{t("world.building", { n: Math.round((project.progress / tech.cost) * 100) })}</Pill>
                        : target?.id === tech.id ? <Pill tone="signal">{t("world.researching")}</Pill>
                        : ready ? <Pill tone="water">{t("world.available")}</Pill>
                        : <Pill><Lock size={11} /> {t("world.locked")}</Pill>}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-2">{term.techDescription(tech.id)}</p>
                    <p className="mt-1 text-[12px] text-ink-3">{term.techEffect(tech.id)}</p>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                      <Pill>{t("world.cost", { n: tech.cost })}</Pill>
                      <Pill>{t("world.materialsCost", { n: tech.materials })}</Pill>
                      {tech.prerequisites.map((p) => <Pill key={p} tone={state.technologies.includes(p) ? "ok" : "neutral"}>{t("world.needs", { tech: term.techName(p) })}</Pill>)}
                      {tech.minPopulation && <Pill tone={popBlocked ? "warn" : "ok"}>{t("world.minPop", { n: tech.minPopulation })}</Pill>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

async function WorldFlags({ state }: { state: WorldState }) {
  const { t, term } = await getI18n();
  const flags = Object.entries(state.flags).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("world.governance")} />
        <div className="px-4 pb-4">
          <KeyValue items={[
            [t("world.councilPolicy"), term.policyName(state.policy)],
            [t("world.researchFocus"), state.researchFocus ? term.techName(state.researchFocus) : t("world.policyDecides")],
            [t("world.rulesVersion"), <span key="r" className="num">{state.rulesVersion}</span>],
            [t("world.seedRng"), <span key="s" className="num">{state.seed} / {state.rng}</span>],
            [t("compare.peak"), state.stats.peakPopulation],
          ]} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("world.secrets")} subtitle={t("world.secretsSub")} />
        <ul className="space-y-2 px-4 pb-4">
          {Object.values(SECRET_BY_ID).map((s) => {
            const r = state.secrets[s.id];
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[13px]">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{r ? term.secretTitle(s.id) : t("world.unknownSecret")}</span>{r ? <Link href={`/history/${r.historyId}`}><Pill tone="signal">{t("world.revealed", { year: state.startYear + r.revealedTick })}</Pill></Link> : <Pill><Lock size={11} /> {t("world.hidden")}</Pill>}</div>
                {r && <p className="mt-1 text-ink-2">{term.secretRevelation(s.id)}</p>}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader title={t("world.flags")} subtitle={t("world.flagsSub", { n: flags.length })} />
        {flags.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("world.noFlags")}</p> : (
          <ul className="divide-y divide-line">
            {flags.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                <span className="num min-w-0 truncate text-ink">{k}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="num text-ink-3">{String(v)}</span>
                  {state.flagOrigins[k] && <Link className="text-[12px] text-signal" href={`/history/${state.flagOrigins[k]}`}>{t("world.source")}</Link>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("world.map")} icon={<MapPin size={16} />} />
        <ul className="divide-y divide-line">
          {state.locations.map((l) => {
            const info = LOCATION_BY_ID[l.id]!;
            return (
              <li key={l.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className={l.discovered ? "font-medium" : "text-ink-3"}>{l.discovered ? info.name : t("world.unknownRegion")}</span>
                  <span className="flex gap-1">
                    {l.settlementId && <Pill tone="ok">{t("world.settled")}</Pill>}
                    {l.discovered && info.settleable && !l.settlementId && <Pill tone="water">{t("world.openSite")}</Pill>}
                    {!l.discovered && <Pill>{info.hidden ? t("world.hidden") : t("world.distance", { n: info.distance })}</Pill>}
                  </span>
                </div>
                {l.discovered && <p className="mt-0.5 text-ink-3">{term.locationDescription(l.id)} {info.features.map(term.feature).join(" · ")}</p>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
