// Shapes shared by the Revisão Espaçada screens (BR-05, epic #67 slice S2c).
//
// ONE mapper for the two doors into the review: a fresh queue from
// `questions.reviewQueue` and a resumed one from `questions.byIds`. They differ
// in exactly one way — `byIds` LEFT JOINs the SM-2 state, so its columns are
// nullable for a question the student has never seen — and a second mapper is
// how the two doors would drift apart.

import { shuffle } from '../shared/lib/shuffle';
import type { AnswerDraft } from '@shared/run/exit-rules';
import type { ReviewItem } from './spaced-screens';

/** What either door gives us: a question plus (maybe) its SM-2 state. */
export interface ReviewRowLike {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  aiExplanation?: ReviewItem['aiExplanation'] | undefined;
  discipline: string;
  examBoard: string;
  difficulty: string;
  legislationTitle: string | null;
  interval: number | null;
  repetitions: number | null;
  nextReviewAt: string | null;
  lastCorrect: boolean | null;
}

/**
 * Row → review on screen. The alternatives are shuffled per mount and
 * deliberately NOT persisted: an answer is stored as the TEXT of the
 * alternative, so re-shuffling on resume changes nothing about what was
 * answered.
 *
 * A question with no `user_question_states` row reads as "never reviewed"
 * (interval 1 / 0 repetitions — the SM-2 defaults of the column), which is
 * exactly what the schedule would give it on its first answer.
 */
export function toReviewItem(row: ReviewRowLike): ReviewItem {
  return {
    id: row.id,
    questionText: row.questionText,
    options: shuffle(row.options),
    correctAnswer: row.correctAnswer,
    explanation: row.explanation,
    aiExplanation: row.aiExplanation ?? null,
    discipline: row.discipline,
    examBoard: row.examBoard,
    difficulty: row.difficulty,
    legislationTitle: row.legislationTitle,
    interval: row.interval ?? 1,
    repetitions: row.repetitions ?? 0,
    nextReviewAt: row.nextReviewAt ?? '',
    lastCorrect: row.lastCorrect,
  };
}

/**
 * Everything a review run needs to be on the board — from a fresh queue or from
 * a resumed draft. `draft` is the row this run already owns on the server
 * (`{ id, token }`), null for a review that has never been persisted.
 */
export interface SpacedRunStart {
  questions: ReviewItem[];
  cursor: number;
  answers: AnswerDraft[];
  draft: { id: string; token: string } | null;
}
