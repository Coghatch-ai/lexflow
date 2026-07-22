// apps/mobile/src/components/CoachCard.tsx
//
// "Análise do Coach" — the weak-point digest card on Progresso. Serves the
// cached digest (coach.latest); generation is one relay job via runCoachFlow.
// Below COACH_MIN_ANSWERED the backend refuses — the error message doubles as
// the empty state.

import { useState, type ReactElement } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { CoachDigest } from "@shared/domain/ai-coach";
import { runCoachFlow } from "@shared/lib/run-coach-flow";
import { trpc } from "../lib/trpc";

const SEVERITY_TONE: Record<CoachDigest["priorities"][number]["severity"], string> = {
  alta: "bg-neg/10 text-neg",
  media: "bg-warn/10 text-warn",
  baixa: "bg-pos/10 text-pos",
};

export function CoachCard(): ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const latestQ = trpc.coach.latest.useQuery();
  const generateMut = trpc.coach.generate.useMutation();
  const finalizeMut = trpc.coach.finalize.useMutation();

  const latest = latestQ.data ?? null;
  const digest = latest?.digest ?? null;

  async function generate(force: boolean): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await runCoachFlow(force, {
        generate: (input) => generateMut.mutateAsync(input),
        fetchRelayJob: (jobId) => utils.relay.job.fetch({ jobId }, { staleTime: 0 }),
        finalize: (input) => finalizeMut.mutateAsync(input),
      });
      await utils.coach.latest.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar a análise");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" /> Análise do Coach
        </p>
        {digest !== null ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              void generate(true);
            }}
            aria-label="Atualizar análise"
            className="flex items-center gap-1 text-xs font-semibold text-ink-mute disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        ) : null}
      </div>

      {error !== null ? <p className="text-xs text-neg">{error}</p> : null}

      {digest === null ? (
        <div className="card-default flex flex-col items-start gap-2">
          <p className="text-sm text-ink-soft">
            O coach analisa os seus erros — disciplinas fracas, chutes rápidos e lacunas — e diz o
            que atacar primeiro.
          </p>
          <button
            type="button"
            disabled={loading || latestQ.isLoading}
            onClick={() => {
              void generate(false);
            }}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {loading ? "Analisando…" : "Gerar análise"}
          </button>
        </div>
      ) : (
        <div className="card-default flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-ink">{digest.diagnosis}</p>

          {digest.priorities.length > 0 ? (
            <div className="flex flex-col gap-2">
              {digest.priorities.map((p) => (
                <div key={p.discipline} className="flex items-start gap-2">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase ${SEVERITY_TONE[p.severity]}`}
                  >
                    {p.severity}
                  </span>
                  <p className="text-sm text-ink-soft">
                    <span className="font-semibold text-ink">{p.discipline}</span> — {p.reason}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {digest.actions.length > 0 ? (
            <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
              {digest.actions.map((a) => (
                <li key={a.title} className="text-sm text-ink-soft">
                  <span className="font-semibold text-ink">{a.title}.</span> {a.detail}
                </li>
              ))}
            </ul>
          ) : null}

          {latest !== null ? (
            <p className="text-[0.7rem] text-ink-mute">
              Gerada em {new Date(latest.generatedAt).toLocaleDateString("pt-BR")}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
