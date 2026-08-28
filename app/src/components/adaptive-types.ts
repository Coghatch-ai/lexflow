// Shapes shared by the Simulado Adaptativo screens (BR-05, epic #67 slice S2c).
//
// `AdaptiveRunStart` is what the entry hands the board, from either door: a
// fresh setup (`questions` = the single first question, empty FIFO, empty
// ladder) or a resumed draft (the whole served list, its cursor, the FIFO and
// the ladder verbatim). One shape, so the board has exactly one seeding path.

import type { AnswerDraft } from '@shared/run/exit-rules';
import type { AdaptiveQuestion, AdaptiveState } from './adaptive-screens';

/** The filters a simulado was started with, as `exam_drafts.setup` stores them. */
export interface AdaptiveRunSetup {
  /** LOV code, or '' for "todas as disciplinas". */
  discipline: string;
  totalQuestions: number;
}

export interface AdaptiveRunStart {
  /**
   * The CANDIDATE pool — always freshly drawn from `questions.list`, never
   * persisted: it is not progress, and `fetchQuestion` treats everything
   * already served as seen, so a new draw cannot repeat a question.
   */
  pool: AdaptiveQuestion[];
  /** The questions SERVED so far; holds a duplicate when a parked one returns. */
  questions: AdaptiveQuestion[];
  /** A position in `questions` — never an id, which may appear twice. */
  cursor: number;
  /** The "Responder depois" FIFO, oldest first (BR-03.1). */
  deferred: AdaptiveQuestion[];
  answers: AnswerDraft[];
  adaptive: AdaptiveState;
  setup: AdaptiveRunSetup;
  elapsedSeconds: number;
  /** The row this run already owns on the server, or null if never persisted. */
  draft: { id: string; token: string } | null;
}

/** Where a brand-new ladder starts (`DEFAULT_ADAPTIVE_CONFIG.startDifficulty`). */
export const INITIAL_ADAPTIVE: AdaptiveState = {
  currentDifficulty: 'medium',
  consecutiveCorrect: 0,
  consecutiveWrong: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  difficultyHistory: [],
};
