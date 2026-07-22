import { useMemo, type ReactElement } from "react";
import { AlertTriangle, Clock, Play, Target, TrendingUp } from "lucide-react";
import { trpc } from "../lib/trpc";
import { META_SEP } from "@shared/domain/ui-format";
import { CoachCard } from "../components/CoachCard";

// Read-only performance dashboard. Mirrors the web Analytics page but renders
// plain CSS bars instead of pulling in a charting lib (lighter mobile bundle).
export function ProgressPage(): ReactElement {
  const summaryQ = trpc.stats.summary.useQuery();
  const byDisciplineQ = trpc.stats.byDiscipline.useQuery();
  const recurringErrorsQ = trpc.stats.recurringErrors.useQuery();
  const byResponseTimeQ = trpc.stats.byResponseTime.useQuery();

  const summary = summaryQ.data;
  const disciplines = useMemo(
    () => [...(byDisciplineQ.data ?? [])].sort((a, b) => b.accuracy - a.accuracy),
    [byDisciplineQ.data],
  );
  const errors = recurringErrorsQ.data ?? [];
  const buckets = byResponseTimeQ.data ?? [];

  return (
    <div className="stagger flex flex-col gap-6 px-4 py-6 pb-24">
      <header>
        <p className="eyebrow !text-seal">Desempenho</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tightish text-ink">
          Progresso
        </h1>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Acerto geral"
          value={`${summary?.accuracy ?? 0}%`}
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Respondidas"
          value={`${summary?.totalAnswered ?? 0}`}
        />
        <StatCard
          icon={<Play className="h-4 w-4" />}
          label="Sessões"
          value={`${summary?.totalSessions ?? 0}`}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Tempo médio"
          value={`${summary?.averageTimePerQuestion ?? 0}s`}
        />
      </div>

      <CoachCard />

      {/* Accuracy by discipline */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Por disciplina</p>
        {byDisciplineQ.isLoading ? (
          <p className="text-sm text-ink-mute">Carregando…</p>
        ) : disciplines.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Responda algumas questões para ver seu desempenho.
          </p>
        ) : (
          <div className="card-default flex flex-col gap-3.5">
            {disciplines.map((d) => (
              <div key={d.discipline}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{d.discipline}</span>
                  <span className="shrink-0 text-xs font-semibold tnum text-ink-mute">
                    {d.accuracy}% {META_SEP} {d.totalAnswered}
                  </span>
                </div>
                <Bar pct={d.accuracy} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Response-time buckets */}
      {buckets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <p className="eyebrow">Tempo de resposta</p>
          <div className="grid grid-cols-3 gap-3">
            {(["fast", "medium", "slow"] as const).map((key) => {
              const b = buckets.find((x) => x.bucket === key);
              const total = b?.total ?? 0;
              const errs = b?.errors ?? 0;
              const errRate = total > 0 ? Math.round((100 * errs) / total) : 0;
              return (
                <div key={key} className="card-default flex flex-col items-start gap-1 !p-3">
                  <span className="text-[0.7rem] text-ink-mute">{TIME_LABEL[key]}</span>
                  <span className="text-xl font-bold tnum leading-none text-ink">{total}</span>
                  <span className="text-[0.7rem] text-neg">{errRate}% erro</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Recurring errors */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Pontos fracos</p>
        {errors.length === 0 ? (
          <p className="text-sm text-ink-mute">Nenhum erro recorrente. Continue assim! 🎯</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {errors.map((e) => (
              <li
                key={e.questionId}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-warn" strokeWidth={1.75} />
                <span className="flex-1 truncate text-sm text-ink">{e.discipline}</span>
                <span className="shrink-0 text-xs font-semibold tnum text-neg">
                  {e.timesWrong}/{e.timesAnswered} erradas
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const TIME_LABEL: Record<"fast" | "medium" | "slow", string> = {
  fast: "Rápido",
  medium: "Médio",
  slow: "Lento",
};

function Bar({ pct }: { pct: number }): ReactElement {
  const tone = pct >= 70 ? "bg-pos" : pct >= 50 ? "bg-warn" : "bg-neg";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
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
