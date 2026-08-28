import { useMemo, type ReactElement } from "react";
import { useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import type { RunnerQuestion } from "../components/QuestionRunner";
import { RunStartGate } from "../components/RunStartGate";
import { Centered } from "../components/Centered";

// Spaced-repetition review: questions.reviewQueue returns the cards whose
// SM-2 next_review_at is due. Recording answers (inside QuestionRunner) reschedules
// them — no separate "review" backend, the queue feeds the same flow as practice.
// Sessions are tagged "Revisão"; per-answer stats still resolve to each question's
// real discipline via the userAnswers->oab_questions join.
export function ReviewPage(): ReactElement {
  const [, navigate] = useLocation();
  const queueQ = trpc.questions.reviewQueue.useQuery(undefined, { refetchOnWindowFocus: false });

  // reviewQueue rows already carry exactly the RunnerQuestion fields.
  const questions = useMemo<RunnerQuestion[]>(() => queueQ.data ?? [], [queueQ.data]);

  if (queueQ.isLoading) return <Centered>Carregando revisão…</Centered>;
  if (queueQ.isError) return <Centered>Erro ao carregar. Tente novamente.</Centered>;
  if (questions.length === 0) {
    return (
      <Centered>
        <p className="text-2xl">🎉</p>
        <p className="mt-2 text-ink">Nada para revisar agora.</p>
        <p className="mt-1 text-sm text-ink-mute">Volte mais tarde ou faça uma prática.</p>
        <button
          type="button"
          onClick={() => {
            navigate("/");
          }}
          className="btn-secondary mt-5"
        >
          Voltar ao início
        </button>
      </Centered>
    );
  }

  // A review saves into the `spaced` slot — the same row the desktop's Revisão
  // Espaçada uses, so a run started here continues there (BR-05.2).
  return <RunStartGate surface="review" questions={questions} sessionDiscipline="Revisão" />;
}
