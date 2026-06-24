import type { ReactElement } from "react";
import { useLocation } from "wouter";
import { Check, Home, X } from "lucide-react";
import { accuracyPct } from "@shared/domain/scoring";
import { trpc } from "../lib/trpc";
import { usePracticeState } from "../state/practice-context";

export function ResultPage(): ReactElement {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { result, setResult } = usePracticeState();

  function backHome(): void {
    setResult(null);
    void utils.stats.summary.invalidate();
    void utils.questions.dueCount.invalidate();
    void utils.questions.reviewQueue.invalidate();
    navigate("/");
  }

  if (result === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-ink-mute">Nenhum resultado para mostrar.</p>
        <button type="button" onClick={backHome} className="btn-primary mt-5">
          Voltar ao início
        </button>
      </div>
    );
  }

  const pct = accuracyPct(result.correctAnswers, result.totalQuestions);
  const tone = pct >= 70 ? "text-pos" : pct >= 50 ? "text-warn" : "text-neg";
  const heading = result.mode === "review" ? "Revisão concluída" : "Sessão concluída";

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex-1 px-4 py-8 pb-28">
        {/* Score hero */}
        <div className="panel-ink stagger flex flex-col items-center px-6 py-10 text-center">
          <p className="eyebrow !text-seal-bright">{heading}</p>
          <p className={`mt-3 font-display text-6xl font-bold tnum ${tone}`}>{pct}%</p>
          <p className="mt-2 text-sm text-ink-mute">
            {result.correctAnswers} de {result.totalQuestions} corretas · {result.discipline}
          </p>
        </div>

        {/* Per-question recap */}
        <p className="eyebrow mb-2 mt-7">Revisão</p>
        <ul className="flex flex-col gap-2">
          {result.recap.map((a, i) => (
            <li
              key={a.questionId}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                a.correct ? "border-pos bg-pos/10" : "border-neg bg-neg/10"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {a.correct ? (
                  <Check className="h-5 w-5 text-pos" />
                ) : (
                  <X className="h-5 w-5 text-neg" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-mute">Questão {i + 1}</p>
                <p className="line-clamp-2 text-sm text-ink">{a.questionText}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Action bar */}
      <div
        className="sticky bottom-0 border-t border-line bg-surface px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={backHome}
          className="btn-primary flex w-full items-center justify-center gap-2 text-base"
        >
          <Home className="h-5 w-5" strokeWidth={2} />
          Voltar ao início
        </button>
      </div>
    </div>
  );
}
