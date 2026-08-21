// Rules for leaving a test that is still running (BR-05, epic #67 slice S1).
// Pure module: no React, no tRPC — the four answering screens import these so
// the same rules apply everywhere and stay unit-testable without RTL/jsdom.
//
// This slice only offers "Sair e processar": the run ends now and what was
// already answered is recorded through the normal sessions.record path.
// "Salvar e sair" (resume later) needs server-side storage and arrives in a
// later slice — no mode returns a save option here.

// `RunMode`, `AnswerDraft` and `processableAnswers` are canonical in
// `@shared/domain/exam-draft` — the API persists and settles runs with the same
// rules, and `tsconfig.api.json` never compiles `app/src/`. Re-exported here so
// every screen's import path is unchanged; there is ONE union, not two.
import { processableAnswers, type AnswerDraft, type RunMode } from "@shared/domain/exam-draft";

export { processableAnswers };
export type { AnswerDraft, RunMode };

/** What the confirmation dialog shows. `optionCount` is 2 by design (S1). */
export interface ExitPrompt {
  title: string;
  body: string;
  /** Only the prova real warns (BR-05.5); null on the study modes. */
  warning: string | null;
  continueLabel: string;
  quitLabel: string;
  optionCount: 2;
}

/** Answered / correct / wrong counted against what was ANSWERED, never the queue. */
export interface AnsweredStats {
  answered: number;
  correct: number;
  wrong: number;
}

const REAL_EXAM_WARNING =
  "A prova real não pode ser salva para continuar depois: ao encerrar, ela termina aqui.";

/**
 * Whether a leave attempt must ask first. With nothing answered there is
 * nothing to process and nothing to lose, so the run is left silently —
 * `sessions.record` requires at least one answer and would fail on an empty
 * payload.
 */
export function shouldPromptOnExit(answeredCount: number): boolean {
  return answeredCount > 0;
}

/**
 * The pt-BR dialog for a leave attempt. Exactly two actions in every mode:
 * continue, or end now and process what was answered.
 */
export function exitPrompt(
  mode: RunMode,
  answeredCount: number,
  totalQuestions: number,
): ExitPrompt {
  const answered = String(answeredCount);
  const total = String(totalQuestions);
  const kept = `As ${answered} respostas já dadas serão processadas e contam nas suas estatísticas. As questões não respondidas não são erros e podem aparecer de novo.`;

  if (mode === "real") {
    return {
      title: "Encerrar a prova real?",
      body: `Você respondeu ${answered} de ${total} questões. ${kept}`,
      warning: REAL_EXAM_WARNING,
      continueLabel: "Continuar prova",
      quitLabel: "Encerrar e processar respostas",
      optionCount: 2,
    };
  }

  return {
    title: "Sair do teste em andamento?",
    body: `Você respondeu ${answered} de ${total} questões. ${kept}`,
    warning: null,
    continueLabel: "Continuar",
    quitLabel: "Sair e processar respostas",
    optionCount: 2,
  };
}

/** Result-screen counters for a run that may have ended early. */
export function answeredStats(drafts: readonly AnswerDraft[]): AnsweredStats {
  const processable = processableAnswers(drafts);
  const correct = processable.filter((a) => a.correct).length;
  return { answered: processable.length, correct, wrong: processable.length - correct };
}

/**
 * Joins questions to answers BY QUESTION ID, in answer order, skipping every
 * question that was not answered. The result screens iterate this instead of
 * indexing `answers[idx]`, which is undefined on a partial run (and on a run
 * whose queue was reordered by "Responder depois").
 */
export function rowsForAnswers<Q extends { id: string }>(
  questions: readonly Q[],
  answers: readonly AnswerDraft[],
): { question: Q; answer: AnswerDraft }[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows: { question: Q; answer: AnswerDraft }[] = [];
  for (const answer of processableAnswers(answers)) {
    const question = byId.get(answer.questionId);
    if (question !== undefined) rows.push({ question, answer });
  }
  return rows;
}
