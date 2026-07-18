import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Target, Trash2 } from "lucide-react";
import { goalProgressPct } from "@shared/domain/scoring";
import { trpc } from "../lib/trpc";
import { META_SEP } from "@shared/domain/ui-format";

const TARGET_OPTIONS = [50, 60, 70, 80, 90, 95];

// Per-discipline accuracy targets. "Current" comes from stats.byDiscipline;
// progress = goalProgressPct(current, target). One goal per discipline — the
// form upserts (updates an existing goal for that discipline, else creates).
export function GoalsPage(): ReactElement {
  const utils = trpc.useUtils();
  const goalsQ = trpc.goals.list.useQuery();
  const byDisciplineQ = trpc.stats.byDiscipline.useQuery();
  const disciplinesQ = trpc.questions.disciplines.useQuery();

  const [discipline, setDiscipline] = useState("");
  const [target, setTarget] = useState(70);

  const disciplines = disciplinesQ.data;
  useEffect(() => {
    if (discipline === "" && disciplines !== undefined && disciplines.length > 0) {
      setDiscipline(disciplines[0] ?? "");
    }
  }, [discipline, disciplines]);

  const accuracyByDiscipline = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of byDisciplineQ.data ?? []) map.set(d.discipline, d.accuracy);
    return map;
  }, [byDisciplineQ.data]);

  const goals = goalsQ.data ?? [];

  const createMut = trpc.goals.create.useMutation();
  const updateMut = trpc.goals.update.useMutation();
  const deleteMut = trpc.goals.delete.useMutation();
  const saving = createMut.isPending || updateMut.isPending;

  function invalidate(): void {
    void utils.goals.list.invalidate();
  }

  function save(): void {
    if (discipline === "") return;
    const existing = goals.find((g) => g.discipline === discipline);
    if (existing !== undefined) {
      updateMut.mutate({ id: existing.id, targetAccuracy: target }, { onSuccess: invalidate });
    } else {
      createMut.mutate({ discipline, targetAccuracy: target }, { onSuccess: invalidate });
    }
  }

  function remove(id: string): void {
    deleteMut.mutate({ id }, { onSuccess: invalidate });
  }

  return (
    <div className="stagger flex flex-col gap-5 px-4 py-6 pb-24">
      <header>
        <p className="eyebrow !text-seal">Suas metas</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tightish text-ink">Metas</h1>
        <p className="mt-1 text-sm text-ink-mute">Defina a precisão que você quer atingir.</p>
      </header>

      {/* Add / update form */}
      <div className="card-default flex flex-col gap-4">
        <div>
          <label htmlFor="goal-discipline" className="eyebrow mb-2 block">
            Disciplina
          </label>
          <select
            id="goal-discipline"
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

        <div>
          <span className="eyebrow mb-2 block">Meta de acerto</span>
          <div className="flex flex-wrap gap-2">
            {TARGET_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTarget(t);
                }}
                aria-pressed={target === t}
                className={`rounded-full border px-4 py-2 text-sm font-semibold tnum transition ${
                  target === t
                    ? "border-ink bg-ink text-surface"
                    : "border-line-strong bg-surface text-ink-mute"
                }`}
              >
                {t}%
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || discipline === ""}
          className="btn-primary flex items-center justify-center gap-2 text-base"
        >
          <Target className="h-5 w-5" strokeWidth={2} />
          {saving ? "Salvando…" : "Salvar meta"}
        </button>
      </div>

      {/* Existing goals */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow">Metas definidas</p>
        {goalsQ.isLoading ? (
          <p className="text-sm text-ink-mute">Carregando…</p>
        ) : goals.length === 0 ? (
          <p className="text-sm text-ink-mute">Nenhuma meta ainda. Crie a primeira acima.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {goals.map((g) => (
              <GoalCard
                key={g.id}
                discipline={g.discipline}
                target={g.targetAccuracy}
                current={accuracyByDiscipline.get(g.discipline) ?? 0}
                onRemove={() => {
                  remove(g.id);
                }}
                pending={deleteMut.isPending}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GoalCard({
  discipline,
  target,
  current,
  onRemove,
  pending,
}: {
  discipline: string;
  target: number;
  current: number;
  onRemove: () => void;
  pending: boolean;
}): ReactElement {
  const progress = goalProgressPct(current, target);
  const reached = current >= target;
  return (
    <li className="card-default flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{discipline}</p>
          <p className="text-xs text-ink-mute">
            Atual {current}% {META_SEP} Meta {target}%
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          aria-label="Excluir meta"
          className="text-ink-mute disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-all ${reached ? "bg-pos" : "bg-seal"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {reached ? <p className="text-xs font-semibold text-pos">Meta atingida 🎯</p> : null}
    </li>
  );
}
