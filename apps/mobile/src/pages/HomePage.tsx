import { useEffect, useMemo, type ReactElement } from "react";
import { Link, useLocation } from "wouter";
import { ChevronRight, Crosshair, Flame, Play, Target, TrendingUp } from "lucide-react";
import { goalProgressPct } from "@shared/domain/scoring";
import { useSession } from "../auth";
import { trpc } from "../lib/trpc";
import { usePracticeState } from "../state/practice-context";
import { ExamCountdown } from "../components/ExamCountdown";
import { CreditsChip } from "../components/CreditsChip";

export function HomePage(): ReactElement {
  const [, navigate] = useLocation();
  const { user } = useSession();
  const { discipline, setDiscipline } = usePracticeState();

  const disciplinesQ = trpc.questions.disciplines.useQuery();
  const summaryQ = trpc.stats.summary.useQuery();
  const dueQ = trpc.questions.dueCount.useQuery();
  const goalsQ = trpc.goals.list.useQuery();
  const byDisciplineQ = trpc.stats.byDiscipline.useQuery();
  const drillQ = trpc.questions.focusedDrill.useQuery(undefined, { refetchOnWindowFocus: false });

  const disciplines = disciplinesQ.data;

  // Default to the first discipline once the catalog loads.
  useEffect(() => {
    if (discipline === "" && disciplines !== undefined && disciplines.length > 0) {
      setDiscipline(disciplines[0] ?? "");
    }
  }, [discipline, disciplines, setDiscipline]);

  const accuracyByDiscipline = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of byDisciplineQ.data ?? []) map.set(d.discipline, d.accuracy);
    return map;
  }, [byDisciplineQ.data]);

  const firstName = (user?.name ?? "").split(" ")[0] ?? "";
  const accuracy = summaryQ.data?.accuracy ?? 0;
  const totalAnswered = summaryQ.data?.totalAnswered ?? 0;
  const totalSessions = summaryQ.data?.totalSessions ?? 0;
  const dueCount = dueQ.data?.count ?? 0;
  const goals = (goalsQ.data ?? []).slice(0, 2);
  const ready = discipline !== "" && disciplines !== undefined;

  function start(): void {
    if (ready) navigate("/practice");
  }

  return (
    <div className="stagger flex flex-col gap-5 px-4 py-6 pb-24">
      <header>
        <div className="flex items-start justify-between gap-2">
          <p className="eyebrow !text-seal">Prática diária</p>
          <CreditsChip />
        </div>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tightish text-ink">
          Olá{firstName.length > 0 ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-ink-mute">Pronto para algumas questões da OAB?</p>
      </header>

      <ExamCountdown />

      {/* Due-for-review banner -> review flow */}
      <button
        type="button"
        onClick={() => {
          navigate("/review");
        }}
        className="panel-ink flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Flame className="h-6 w-6 text-seal-bright" strokeWidth={1.75} />
          <div>
            <p className="text-2xl font-bold tnum leading-none text-surface">{dueCount}</p>
            <p className="mt-0.5 text-xs text-ink-mute">questões para revisar</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-ink-mute" />
      </button>

      {/* Focused drill -> weakness-targeted practice */}
      {drillQ.data?.available === true ? (
        <button
          type="button"
          onClick={() => {
            navigate("/drill");
          }}
          className="card-default flex items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 text-seal" strokeWidth={1.75} />
            <div>
              <p className="text-sm font-semibold text-ink">Treino focado</p>
              <p className="mt-0.5 text-xs text-ink-mute">
                {drillQ.data.recurringCount > 0
                  ? `${drillQ.data.recurringCount} erros recorrentes`
                  : "Seus pontos fracos"}
                {drillQ.data.weakestDiscipline !== null
                  ? ` · ${drillQ.data.weakestDiscipline} (${drillQ.data.weakestAccuracy ?? 0}%)`
                  : ""}
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-ink-mute" />
        </button>
      ) : null}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Acerto" value={`${accuracy}%`} />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Respondidas"
          value={`${totalAnswered}`}
        />
        <StatCard icon={<Play className="h-4 w-4" />} label="Sessões" value={`${totalSessions}`} />
      </div>

      {/* Discipline picker + start */}
      <div className="card-default flex flex-col gap-4">
        <div>
          <label htmlFor="discipline" className="eyebrow mb-2 block">
            Disciplina
          </label>
          <select
            id="discipline"
            value={discipline}
            disabled={disciplinesQ.isLoading}
            onChange={(e) => {
              setDiscipline(e.target.value);
            }}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-3 text-base text-ink focus:border-ink"
          >
            {disciplinesQ.isLoading ? (
              <option value="">Carregando…</option>
            ) : (
              (disciplines ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={!ready}
          className="btn-primary flex items-center justify-center gap-2 text-base"
        >
          <Play className="h-5 w-5" strokeWidth={2} />
          Começar prática
        </button>
      </div>

      {/* Goals snapshot */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Metas</p>
          <Link href="/goals" className="text-xs font-semibold text-seal">
            {goals.length > 0 ? "Ver todas" : "Definir meta"}
          </Link>
        </div>
        {goals.length === 0 ? (
          <Link href="/goals" className="card-default text-sm text-ink-mute">
            Defina uma meta de acerto por disciplina para acompanhar seu progresso.
          </Link>
        ) : (
          <div className="card-default flex flex-col gap-3">
            {goals.map((g) => {
              const current = accuracyByDiscipline.get(g.discipline) ?? 0;
              const progress = goalProgressPct(current, g.targetAccuracy);
              return (
                <div key={g.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{g.discipline}</span>
                    <span className="shrink-0 text-xs tnum text-ink-mute">
                      {current}% / {g.targetAccuracy}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full transition-all ${
                        current >= g.targetAccuracy ? "bg-pos" : "bg-seal"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactElement;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="card-default flex flex-col items-start gap-1 !p-3">
      <span className="text-seal">{icon}</span>
      <span className="text-xl font-bold tnum leading-none text-ink">{value}</span>
      <span className="text-[0.7rem] text-ink-mute">{label}</span>
    </div>
  );
}
