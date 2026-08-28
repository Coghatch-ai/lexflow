// apps/mobile/src/pages/DrillPage.tsx
//
// "Treino focado" — weakness-targeted drill: recurring-error questions +
// random questions from the weakest discipline (questions.focusedDrill,
// deterministic, no LLM). Runs the same immersive QuestionRunner as practice.

import { useMemo, type ReactElement } from "react";
import { useLocation } from "wouter";
import { toQuestion, type Question } from "@shared/domain/question";
import { trpc } from "../lib/trpc";
import { RunStartGate } from "../components/RunStartGate";
import { Centered } from "../components/Centered";

export function DrillPage(): ReactElement {
  const [, navigate] = useLocation();
  const drillQ = trpc.questions.focusedDrill.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const questions = useMemo<Question[]>(
    () => (drillQ.data?.questions ?? []).map(toQuestion),
    [drillQ.data],
  );

  if (drillQ.isLoading) return <Centered>Montando seu treino…</Centered>;
  if (drillQ.isError) return <Centered>Erro ao carregar. Tente novamente.</Centered>;
  if (drillQ.data?.available !== true || questions.length === 0) {
    return (
      <Centered>
        <p className="text-ink-mute">
          Responda mais questões para liberar o treino focado nos seus pontos fracos.
        </p>
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

  // questions.length === 0 was guarded above; frontend tsconfig has unchecked
  // index access, so questions[0] types as Question here.
  const sessionDiscipline = drillQ.data.weakestDiscipline ?? questions[0].discipline;

  // The Drill saves exactly like Praticar, into the SAME `standard` slot (#86
  // EMENDA — the owner's rule: same database, same BR-05). Sharing the slot is
  // the rule, not a defect: starting a Drill over a saved Praticar (or the
  // reverse) asks to continue or discard, and never overwrites in silence.
  return (
    <RunStartGate surface="drill" questions={questions} sessionDiscipline={sessionDiscipline} />
  );
}
