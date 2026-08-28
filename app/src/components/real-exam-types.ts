// Shapes shared by the Simulado Real screens (BR-05.5, epic #67 slice S2d).
// Extracted from RealExamSimulation.tsx as a pure move — same reason the
// Simulado Padrão has `testing-standard-types.ts`: the container, the board and
// the setup card must live in separate files to stay under the lint budgets
// (`eslint.config.js` max-lines 500 / max-lines-per-function 250).

import { shuffle } from '../shared/lib/shuffle';
import type { AiExplanation } from '@shared/domain/ai-eval';
import type { AnswerDraft } from '@shared/run/exit-rules';

/** 80 questions, like the real OAB 1ª fase. */
export const QUESTIONS_PER_EXAM = 80;

export type ExamQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
  legislationTitle: string | null;
};

/** The fields of an `oab_questions` row these screens actually read. */
export interface ExamQuestionRowLike {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
  legislationTitle: string | null;
}

/**
 * Row → question on screen. The alternatives are shuffled per render of the
 * queue and deliberately NOT persisted (D8): an answer is stored as the TEXT of
 * the alternative, so re-shuffling on a resume changes nothing about what was
 * answered — only the order they are listed in.
 */
export function toExamQuestion(row: ExamQuestionRowLike): ExamQuestion {
  return {
    id: row.id,
    questionText: row.questionText,
    options: shuffle(row.options),
    correctAnswer: row.correctAnswer,
    difficulty: row.difficulty,
    discipline: row.discipline,
    examBoard: row.examBoard,
    explanation: row.explanation,
    aiExplanation: row.aiExplanation,
    legislationTitle: row.legislationTitle,
  };
}

/**
 * Everything a prova real needs to be on the board — from a fresh draw or from
 * the tab that owns it coming back after a reload.
 *
 * `deadlineAt` is ABSOLUTE and comes from the server on a rehydration (D8):
 * that is what makes reloading the tab not hand back time (criterion 5).
 * `draft` is the row this run already owns (`{ id, token }`), null for a run
 * whose first save has not landed yet.
 */
export interface RealRunStart {
  questions: ExamQuestion[];
  cursor: number;
  answers: AnswerDraft[];
  deadlineAt: string;
  draft: { id: string; token: string } | null;
}

/** `h:mm:ss` of a countdown — the real exam's only clock format. */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The indexes of the queue whose question has an answer — what
 * `ExamQuestionNav` paints and what `findNextUnanswered` walks.
 *
 * DERIVED, never stored: the answers themselves are keyed by `questionId`
 * (D8), because an index is only meaningful against one particular queue. A
 * run persisted by index would write the student's answers onto the wrong
 * questions the moment one of them left the catalog and the queue shifted up.
 */
export function answeredIndexes(
  questions: readonly { id: string }[],
  answersByQuestionId: ReadonlyMap<string, string>,
): Set<number> {
  const indexes = new Set<number>();
  questions.forEach((question, index) => {
    if (answersByQuestionId.has(question.id)) indexes.add(index);
  });
  return indexes;
}
