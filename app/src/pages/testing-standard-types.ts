// Shapes shared by the Simulado Padrão screens (BR-05, epic #67 slice S2b).
// Extracted from TestingPage.tsx as a pure move so the run, its setup screen
// and its question screen can live in separate files under the lint budgets
// (`eslint.config.js` max-lines 500 / max-lines-per-function 250).

import { shuffle } from '../shared/lib/shuffle';
import type { AnswerDraft } from '../shared/lib/exit-rules';

export type TestQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  legislationTitle: string | null;
};

export type Lov = { options: { code: string; value: string }[]; labelOf: (code: string) => string };

/** The fields of an `oab_questions` row this screen actually reads. */
export interface QuestionRowLike {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  legislationTitle: string | null;
}

/**
 * Row → question on screen. The alternatives are shuffled per render of the
 * queue and deliberately NOT persisted (epic #67 ledger): an answer is stored
 * as the TEXT of the alternative, so re-shuffling on resume changes nothing
 * about what was answered.
 */
export function toTestQuestion(row: QuestionRowLike): TestQuestion {
  return {
    id: row.id,
    questionText: row.questionText,
    options: shuffle(row.options),
    correctAnswer: row.correctAnswer,
    difficulty: row.difficulty,
    discipline: row.discipline,
    examBoard: row.examBoard,
    explanation: row.explanation,
    legislationTitle: row.legislationTitle,
  };
}

/** The filters a run was started with, as the setup screen holds them. */
export interface StandardFilters {
  discipline: string;
  examBoard: string;
  difficulty: string;
}

/**
 * Everything a run needs to be on the board — from a fresh draw or from a
 * resumed draft. `draft` is the row this run already owns on the server
 * (`{ id, token }`), null for a run that has never been persisted.
 */
export interface StandardRunStart {
  questions: TestQuestion[];
  cursor: number;
  answers: AnswerDraft[];
  carriedTime: Map<string, number>;
  elapsedSeconds: number;
  filters: StandardFilters;
  draft: { id: string; token: string } | null;
}
