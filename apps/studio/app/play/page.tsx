import { fullName, getCharacter } from "@genesis/narrative";
import { availableOrigins, successionCandidates, TRAITS, PLAYERS } from "@genesis/simulation";
import { queryHistory } from "@genesis/database";
import { ATTRIBUTES } from "@genesis/schemas";
import { EmptyState, ProgressBar, SectionTitle } from "@/components/ui";

const ATTR_COLOR = { health: "bg-ok", social: "bg-signal", knowledge: "bg-knowledge", survival: "bg-materials" } as const;
import { DecisionCard } from "@/components/play/decision-card";
import { Onboarding, type InviteInfo } from "@/components/play/onboarding";
import { Prologue } from "@/components/play/prologue";
import { Succession } from "@/components/play/succession";
import { RenameCharacter } from "@/components/play/rename";
import { ageOf, decisionViews, loadPlay } from "@/lib/play";
import { db } from "@/lib/server";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function YearPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { t, term } = await getI18n();
  const ctx = await loadPlay();
  if (!ctx) return <div className="pt-10"><EmptyState title={t("play.noWorld.title")}>{t("play.noWorld.body")}</EmptyState></div>;
  const { state, player, character } = ctx;
  const year = state.startYear + state.tick;

  // Not in the world yet (or left): join.
  if (!player || player.status === "left") {
    const code = (await searchParams).invite;
    let invite: InviteInfo | null = null;
    if (code) {
      const inv = state.invites?.[code];
      const inviter = inv ? getCharacter(state, inv.fromCharacterId) : undefined;
      const target = inv?.characterId ? getCharacter(state, inv.characterId) : undefined;
      invite = {
        code,
        inviter: inviter ? fullName(inviter) : "?",
        kind: inv?.kind ?? "next_child",
        character: target ? fullName(target) : null,
        error: !inv ? "not found" : inv.acceptedBy ? "already used" : inv.expiresTick < state.tick ? "expired" : null,
      };
    }
    const origins = availableOrigins(state).map((o) => ({
      id: o.id,
      available: o.available,
      reason: o.reason,
      settlements: o.settlementIds.map((id) => ({ id, name: state.settlements.find((s) => s.id === id)?.name ?? id })),
    }));
    return <Onboarding year={year} yearsOpen={state.tick} origins={origins} traits={TRAITS} invite={invite} />;
  }

  if (player.status === "awaiting_birth") {
    return (
      <div className="space-y-3 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("play.waitingBirth.title")}</h1>
        <p className="text-ink-2">{t("play.waitingBirth.body")}</p>
      </div>
    );
  }

  if (player.status === "awaiting_succession" || !character) {
    const lastId = player.lineage.at(-1);
    const last = lastId ? getCharacter(state, lastId) : undefined;
    const candidates = successionCandidates(state, player.id).map((c) => {
      const ch = getCharacter(state, c.characterId)!;
      return { id: ch.id, name: fullName(ch), kind: c.kind, age: ageOf(state, ch), home: state.settlements.find((s) => s.id === ch.homeId)?.name ?? "" };
    });
    return (
      <Succession
        dead={last ? { name: fullName(last), year: state.startYear + (last.deathTick ?? state.tick), age: ageOf(state, last), cause: last.causeOfDeath ?? "" } : null}
        candidates={candidates}
      />
    );
  }

  if ((player.prologue?.length ?? 0) < 3) return <Prologue done={player.prologue ?? []} nextTickAt={ctx.clock.nextTickAt} minutes={ctx.clock.minutes} />;

  const home = state.settlements.find((s) => s.id === character.homeId);
  const decisions = decisionViews(ctx);
  const story = [...character.lifeEvents].reverse().slice(0, 8);
  const news = home ? queryHistory(db(), ctx.runId, { settlementId: home.id, minImportance: "notable", order: "desc", limit: 4 }).items.filter((e) => e.tick >= state.tick - PLAYERS.inviteTtl) : [];

  return (
    <div>
      <section className="card flex items-center gap-4 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-signal/40 bg-signal/10 font-semibold text-signal">{/[\u3400-\u9fff]/.test(character.familyName) ? character.familyName : `${character.givenName[0] ?? ""}${character.familyName[0] ?? ""}`}</span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{fullName(character)}</h1>
          <p className="text-sm text-ink-2">
            {t("play.me.age", { age: ageOf(state, character) })} · {character.profession ? term.profession(character.profession) : t("play.me.child")} · {character.traits.map((x) => term.trait(x)).join(" · ")}
          </p>
          {home && <p className="text-xs text-ink-3">{t("play.me.home", { place: home.name })}</p>}
          <RenameCharacter givenName={character.givenName} familyName={character.familyName} />
        </div>
      </section>
      {character.attributes && (
        <section className="card mt-3 grid grid-cols-2 gap-x-4 gap-y-3 p-4" aria-label={t("play.attr.title")}>
          {ATTRIBUTES.map((k) => (
            <div key={k} className="min-w-0 space-y-1" title={t(`play.attr.${k}.hint`)}>
              <div className="flex justify-between text-xs"><span className="text-ink-2">{t(`play.attr.${k}`)}</span><span className="num">{character.attributes![k]}</span></div>
              <ProgressBar value={character.attributes![k]} max={100} color={ATTR_COLOR[k]} />
            </div>
          ))}
        </section>
      )}

      <SectionTitle>{t("play.decisions.title")}</SectionTitle>
      {decisions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">{t("play.decisions.empty")}</p>
      ) : (
        <div className="space-y-3">{decisions.map((d) => <DecisionCard key={d.id} d={d} />)}</div>
      )}

      <SectionTitle>{t("play.report.title")}</SectionTitle>
      {story.length === 0 ? (
        <p className="text-sm text-ink-3">{t("play.report.empty")}</p>
      ) : (
        <ol className="card divide-y divide-line">
          {story.map((e, i) => (
            <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
              <span className="num w-11 shrink-0 text-ink-3">{state.startYear + e.tick}</span>
              <span className="min-w-0">{e.text}</span>
            </li>
          ))}
        </ol>
      )}

      {home && (
        <>
          <SectionTitle>{t("play.news.title", { place: home.name })}</SectionTitle>
          {news.length === 0 ? (
            <p className="text-sm text-ink-3">{t("play.news.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {news.map((e) => (
                <li key={e.id} className="card px-4 py-3">
                  <div className="num text-[11px] text-ink-3">{e.year}</div>
                  <div className="text-sm font-medium">{e.title}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
