// apps/mobile/src/components/RunStartGate.tsx
//
// BR-05.8 on mobile (#86 M2b): before a run starts, ask the server whether this
// mode already has an unfinished one. If it does, the student CONTINUES it or
// DISCARDS it — a new run never overwrites a saved one in silence.
//
// Praticar and Treino focado deliberately share the `standard` slot (the
// product owner's rule: same database, same BR-05 — `mobileRunMode`), so
// starting one over the other lands here rather than destroying it.
//
// A resume NEVER re-queries the fresh source (`questions.list` orders by
// `random()`, `reviewQueue` moves as SM-2 advances): it replays the frozen
// `questionIds` through `questions.byIds`, and `mobileResume` re-imposes the
// persisted order because `inArray` answers in database order.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { toQuestion } from "@shared/domain/question";
import { answeredOf, draftTotalOf, type AnswerDraft } from "@shared/domain/exam-draft";
import { persistedDraftOf } from "@shared/run/run-persistence";
import { mobileResume, mobileRunMode, type MobileSurface } from "@shared/run/mobile-run";
import { FRESH_READ, trpc } from "../lib/trpc";
import { Centered } from "./Centered";
import { QuestionRunner, type RunResumeSeed, type RunnerQuestion } from "./QuestionRunner";
import type { TrackedAnswer } from "./use-run-exit";

const DROPPED_NOTICE = "Algumas questões saíram do catálogo e foram removidas do teste.";
const ALL_DROPPED_NOTICE =
  "As questões deste teste saíram do catálogo, então o teste salvo foi descartado.";

type Phase =
  | { kind: "checking" }
  | { kind: "offer"; answered: number; total: number }
  | { kind: "fresh" }
  | { kind: "resumed"; questions: RunnerQuestion[]; discipline: string; seed: RunResumeSeed };

/**
 * Rebuilds the runner's answers from the persisted drafts plus the questions
 * they belong to. `exam_drafts` stores only what `sessions.record` needs, so
 * the Result recap's text/options are re-joined here by question id — an answer
 * whose question left the catalog is already gone (`mobileResume` reconciles).
 */
function trackedFrom(
  questions: readonly RunnerQuestion[],
  answers: readonly AnswerDraft[],
): TrackedAnswer[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const tracked: TrackedAnswer[] = [];
  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (question === undefined) continue;
    tracked.push({
      questionId: answer.questionId,
      questionText: question.questionText,
      options: question.options,
      userAnswer: answer.userAnswer,
      correctAnswer: question.correctAnswer,
      correct: answer.correct,
      timeSpent: answer.timeSpent,
    });
  }
  return tracked;
}

export function RunStartGate({
  surface,
  questions,
  sessionDiscipline,
}: {
  surface: MobileSurface;
  /** The freshly drawn queue, used only when no saved run is continued. */
  questions: RunnerQuestion[];
  sessionDiscipline: string;
}): ReactElement {
  const mode = mobileRunMode(surface);
  const utils = trpc.useUtils();
  const discardMut = trpc.examDrafts.discard.useMutation();

  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [notice, setNotice] = useState<string | null>(null);
  // A fresh scheduler and a fresh draft identity per run — no reset path to get
  // wrong when a conflict or a discard starts the mode over.
  const [runKey, setRunKey] = useState(0);

  const checkSaved = async (): Promise<void> => {
    setPhase({ kind: "checking" });
    // `persistedDraftOf` restores the `| null` the frontend program cannot
    // infer; `FRESH_READ` because a cached answer here is a row that no longer
    // exists (or an absence that already ended).
    const row = persistedDraftOf(await utils.examDrafts.get.fetch({ mode }, FRESH_READ));
    if (row === null) {
      setPhase({ kind: "fresh" });
      return;
    }
    setPhase({ kind: "offer", answered: answeredOf(row), total: draftTotalOf(row) });
  };

  const continueSaved = async (): Promise<void> => {
    setPhase({ kind: "checking" });
    const row = persistedDraftOf(await utils.examDrafts.get.fetch({ mode }, FRESH_READ));
    if (row === null) {
      setPhase({ kind: "fresh" });
      return;
    }
    const rows = await utils.questions.byIds.fetch({ ids: row.questionIds });
    const resumed = mobileResume(row, rows.map(toQuestion));
    if (resumed.discard) {
      // Nothing survived in the catalog: the run cannot be resumed and must not
      // be recorded either (`user_answers` has an FK to `oab_questions`).
      await discardMut.mutateAsync({ mode });
      await utils.examDrafts.invalidate();
      setNotice(ALL_DROPPED_NOTICE);
      setPhase({ kind: "fresh" });
      return;
    }
    if (resumed.dropped > 0) setNotice(DROPPED_NOTICE);
    setPhase({
      kind: "resumed",
      questions: resumed.questions,
      discipline: resumed.discipline ?? sessionDiscipline,
      seed: {
        cursor: resumed.cursor,
        answers: trackedFrom(resumed.questions, resumed.answers),
        carriedTime: resumed.carriedTime,
        // The token travels VERBATIM — it is the raw PG text the optimistic
        // guard matches with `=`.
        draft: { id: row.id, token: row.lastSavedAt },
      },
    });
    setRunKey((key) => key + 1);
  };

  const discardSaved = async (): Promise<void> => {
    setPhase({ kind: "checking" });
    await discardMut.mutateAsync({ mode });
    await utils.examDrafts.invalidate();
    setPhase({ kind: "fresh" });
    setRunKey((key) => key + 1);
  };

  // No dependency array by design: the ref is what makes it run exactly once,
  // without a hand-maintained dep list.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void checkSaved();
  });

  if (notice !== null) {
    return (
      <Centered>
        <p className="text-ink-soft">{notice}</p>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
          }}
          className="btn-primary mt-5"
        >
          Continuar
        </button>
      </Centered>
    );
  }

  if (phase.kind === "checking") return <Centered>Verificando teste salvo…</Centered>;

  if (phase.kind === "offer") {
    return (
      <Centered>
        <p className="text-base font-semibold text-ink">Você tem um teste em andamento.</p>
        <p className="mt-1 text-sm text-ink-mute">
          Continue de onde parou ou descarte-o para começar um novo.
        </p>
        <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              void continueSaved();
            }}
            className="btn-primary w-full text-base"
          >
            Continuar ({phase.answered}/{phase.total})
          </button>
          <button
            type="button"
            onClick={() => {
              void discardSaved();
            }}
            className="w-full rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink-soft active:bg-paper-sink"
          >
            Descartar e começar novo
          </button>
        </div>
      </Centered>
    );
  }

  if (phase.kind === "resumed") {
    return (
      <QuestionRunner
        key={runKey}
        questions={phase.questions}
        sessionDiscipline={phase.discipline}
        surface={surface}
        resume={phase.seed}
        onReloadFromServer={() => {
          void continueSaved();
        }}
        onRestart={() => {
          setPhase({ kind: "fresh" });
          setRunKey((key) => key + 1);
        }}
      />
    );
  }

  return (
    <QuestionRunner
      key={runKey}
      questions={questions}
      sessionDiscipline={sessionDiscipline}
      surface={surface}
      onReloadFromServer={() => {
        void continueSaved();
      }}
      onRestart={() => {
        setRunKey((key) => key + 1);
      }}
    />
  );
}
