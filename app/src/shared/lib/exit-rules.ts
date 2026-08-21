// Rules for leaving a test that is still running (BR-05, epic #67 S1 + S2b).
// Pure module: no React, no tRPC — the four answering screens import these so
// the same rules apply everywhere and stay unit-testable without RTL/jsdom.
//
// Two actions always exist: continue, or end now and record what was answered
// through the normal `sessions.record` path. Since S2b (#77) the three STUDY
// modes also offer "Salvar e sair" (BR-05.3) — server-side persistence landed
// in S2a — and the prova real still refuses it (BR-05.5: it never resumes).
//
// This module says what the RULE allows, never what a given screen can do. The
// dialog renders the third button only when a screen ALSO passed an `onSave`
// handler, so a mode whose wiring has not landed yet (the Espaçada and the
// Adaptativo, #78) keeps two buttons without forking a second rule set.

// `RunMode`, `AnswerDraft` and `processableAnswers` are canonical in
// `@shared/domain/exam-draft` — the API persists and settles runs with the same
// rules, and `tsconfig.api.json` never compiles `app/src/`. Re-exported here so
// every screen's import path is unchanged; there is ONE union, not two.
import { processableAnswers, type AnswerDraft, type RunMode } from "@shared/domain/exam-draft";

export { processableAnswers };
export type { AnswerDraft, RunMode };

/** What the confirmation dialog shows. */
export interface ExitPrompt {
  title: string;
  body: string;
  /** Only the prova real warns (BR-05.5); null on the study modes. */
  warning: string | null;
  continueLabel: string;
  quitLabel: string;
  /** "Salvar e sair" on the study modes; null on the prova real (BR-05.5). */
  saveLabel: string | null;
  /** 3 wherever `saveLabel` exists, 2 where it does not. */
  optionCount: 2 | 3;
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

/** The label of the third action — one string, used by every study mode. */
const SAVE_AND_EXIT_LABEL = "Salvar e sair";

/**
 * The pt-BR dialog for a leave attempt: continue, end now and process what was
 * answered, and — on the study modes only — save and continue later.
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
      // BR-05.5: a prova real is never saved to continue later, so the third
      // action does not exist for it — not even as a disabled button.
      saveLabel: null,
      optionCount: 2,
    };
  }

  return {
    title: "Sair do teste em andamento?",
    body: `Você respondeu ${answered} de ${total} questões. ${kept}`,
    warning: null,
    continueLabel: "Continuar",
    quitLabel: "Sair e processar respostas",
    saveLabel: SAVE_AND_EXIT_LABEL,
    optionCount: 3,
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
