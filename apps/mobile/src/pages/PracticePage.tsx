import { useEffect, useMemo, type ReactElement } from "react";
import { useLocation } from "wouter";
import { toQuestion, type Question } from "@shared/domain/question";
import { trpc } from "../lib/trpc";
import { usePracticeState } from "../state/practice-context";
import { RunStartGate } from "../components/RunStartGate";
import { Centered } from "../components/Centered";

const QUESTION_LIMIT = 10;

// Fresh-practice screen: pull a batch for the discipline chosen on Home, then
// hand off to the shared QuestionRunner (same flow as spaced-repetition review).
export function PracticePage(): ReactElement {
  const [, navigate] = useLocation();
  const { discipline } = usePracticeState();

  const listQ = trpc.questions.list.useQuery(
    { discipline, limit: QUESTION_LIMIT },
    { enabled: discipline !== "", refetchOnWindowFocus: false },
  );

  const questions = useMemo<Question[]>(() => (listQ.data ?? []).map(toQuestion), [listQ.data]);

  // Opened /practice without choosing a discipline -> back to Home.
  useEffect(() => {
    if (discipline === "") navigate("/");
  }, [discipline, navigate]);

  if (discipline === "") return <Centered>Redirecionando…</Centered>;
  if (listQ.isLoading) return <Centered>Carregando questões…</Centered>;
  if (listQ.isError) return <Centered>Erro ao carregar. Tente novamente.</Centered>;
  if (questions.length === 0) {
    return (
      <Centered>
        <p className="text-ink-mute">Sem questões para esta disciplina.</p>
        <button
          type="button"
          onClick={() => {
            navigate("/");
          }}
          className="btn-secondary mt-4"
        >
          Voltar
        </button>
      </Centered>
    );
  }

  // The gate asks for a saved run first (BR-05.8) — Praticar and Treino focado
  // share the `standard` slot, so one may be waiting when the other starts.
  return <RunStartGate surface="practice" questions={questions} sessionDiscipline={discipline} />;
}
