import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Heart, ScrollText } from "lucide-react";
import { characterAge, fullName } from "@genesis/narrative";
import { Card, CardHeader, KeyValue, Pill } from "@/components/ui";
import { AssignProfession } from "@/components/assign-profession";
import { loadActiveRun } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, term } = await getI18n();
  const run = loadActiveRun();
  if (!run) notFound();
  const { state } = run;
  const c = state.characters.find((x) => x.id === id);
  if (!c) notFound();
  const home = state.settlements.find((s) => s.id === c.homeId);
  const parents = c.parentIds.map((pid) => state.characters.find((x) => x.id === pid)).filter((x) => x !== undefined);
  const children = state.characters.filter((x) => x.parentIds.includes(c.id));
  const relations = Object.entries(state.relationships)
    .filter(([k]) => k.split("|").includes(c.id))
    .map(([k, v]) => ({ other: state.characters.find((x) => x.id === k.split("|").find((p) => p !== c.id)), value: v }))
    .filter((r) => r.other)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const alive = c.deathTick === null;
  const player = c.controllerId ? state.players?.[c.controllerId] : undefined;
  const caretakers = (c.caretakerIds ?? []).map((cid) => state.characters.find((x) => x.id === cid)).filter((x) => x !== undefined);
  const age = characterAge(state, c);

  return (
    <div className="space-y-4">
      <Link href="/world?tab=people" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"><ArrowLeft size={16} /> {t("world.people")}</Link>
      <Card>
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl border text-lg font-semibold ${alive ? "border-signal/40 bg-signal/10 text-signal" : "border-line text-ink-3"}`}>{c.givenName[0]}{c.familyName[0]}</span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{fullName(c)} {!alive && "†"}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill tone={alive ? "ok" : "danger"}>{alive ? t("character.alive") : t("character.deceased")}</Pill>
              {player && <Pill tone="ok">{t("character.playedBy", { player: player.name })}</Pill>}
              <Pill>{term.profession(c.profession)}</Pill>
              {c.traits.map((x) => <Pill key={x}>{term.trait(x)}</Pill>)}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("character.profile")} />
          <div className="px-4 pb-4">
            <KeyValue items={[
              [t("character.born"), <span key="b" className="num">{state.startYear + c.birthTick} ({t("common.tickN", { n: c.birthTick })})</span>],
              [alive ? t("character.age") : t("character.ageAtDeath"), <span key="a" className="num">{age}</span>],
              ...(!alive ? [[t("character.died"), <span key="d" className="num">{state.startYear + c.deathTick!} · {c.causeOfDeath}</span>] as [React.ReactNode, React.ReactNode]] : []),
              [t("character.home"), home ? <Link key="h" className="text-signal" href={`/world/settlements/${home.id}`}>{home.name}</Link> : c.homeId],
              [t("character.parents"), parents.length ? parents.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link className="text-signal" href={`/world/characters/${p.id}`}>{fullName(p)}</Link></span>) : t("character.founders")],
              [t("character.children"), children.length || t("character.none")],
              ...(caretakers.length ? [[t("character.caredForBy"), caretakers.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link className="text-signal" href={`/world/characters/${p.id}`}>{fullName(p)}</Link></span>)] as [React.ReactNode, React.ReactNode]] : []),
            ]} />
            <Link href={`/history?character=${c.id}&importance=`} className="mt-3 inline-flex items-center gap-1.5 text-sm text-signal"><ScrollText size={14} /> {t("character.allHistory", { name: c.givenName })}</Link>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("character.lifeEvents")} subtitle={t("character.recorded", { n: c.lifeEvents.length })} />
          <ol className="relative mx-4 mb-4 space-y-3 border-l border-line pl-4">
            {c.lifeEvents.map((e, i) => (
              <li key={i} className="relative text-[13px]">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-signal/70" />
                <span className="num text-ink-3">{state.startYear + e.tick}</span>{" "}
                {e.historyId ? <Link className="text-ink hover:text-signal" href={`/history/${e.historyId}`}>{e.text}</Link> : <span className="text-ink-2">{e.text}</span>}
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader title={t("character.relationships")} icon={<Heart size={16} />} />
          {relations.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-3">{t("character.noRelationships")}</p> : (
            <ul className="divide-y divide-line">
              {relations.map((r) => (
                <li key={r.other!.id}><Link href={`/world/characters/${r.other!.id}`} className="flex min-h-11 items-center justify-between px-4 text-sm hover:bg-surface-2/50"><span>{fullName(r.other!)}</span><span className={`num ${r.value >= 0 ? "text-ok" : "text-danger"}`}>{r.value > 0 ? "+" : ""}{r.value}</span></Link></li>
              ))}
            </ul>
          )}
        </Card>

        {alive && age >= 16 && run.summary.status === "active" && (
          <Card>
            <CardHeader title={t("character.reassign")} subtitle={t("character.reassignSub")} />
            <div className="px-4 pb-4"><AssignProfession runId={run.summary.id} characterId={c.id} current={c.profession} /></div>
          </Card>
        )}
      </div>
    </div>
  );
}
