// Where the NEXT adaptive question comes from: the drawable pool, the questions
// already served (the cursor walks them) and the `deferred` FIFO that
// "Responder depois" parks questions in (BR-03.1).
//
// Extracted from AdaptiveSimulation.tsx in #70 so the component stays under the
// 250-line ESLint budget — same mechanical split already used for
// adaptive-screens.tsx (render) and real-exam-playing.tsx.
//
// The deferred FIFO is NOT an optimisation: the adaptive mode has no
// materialized queue, so a postponed question left in `questions` is treated as
// already seen by `fetchQuestion` and never comes back. The FIFO is what makes
// "goes to the end of the queue" true here; `shouldServeDeferred`
// (shared/domain/exam-queue.ts) decides when to drain it.

import { useCallback, useRef, useState } from 'react';
import { shuffle } from '../shared/lib/shuffle';
import type { Difficulty, AdaptiveQuestion } from './adaptive-screens';

/** Row shape returned by `questions.list` — mapped into an AdaptiveQuestion. */
type QuestionRow = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  discipline: string;
  examBoard: string;
  explanation: string;
  aiExplanation?: AdaptiveQuestion['aiExplanation'];
  legislationTitle: string | null;
};

/** Map API rows into run questions, shuffling each question's alternatives. */
export function mapAdaptiveRows(rows: readonly QuestionRow[]): AdaptiveQuestion[] {
  return rows.map((r) => ({
    id: r.id,
    questionText: r.questionText,
    options: shuffle(r.options),
    correctAnswer: r.correctAnswer,
    difficulty: r.difficulty as Difficulty,
    discipline: r.discipline,
    examBoard: r.examBoard,
    explanation: r.explanation,
    aiExplanation: r.aiExplanation ?? null,
    legislationTitle: r.legislationTitle,
  }));
}

export interface AdaptivePool {
  /** Every question drawn so far; `currentIndex` points at the one on screen. */
  questions: AdaptiveQuestion[];
  currentIndex: number;
  /** Questions parked by "Responder depois", oldest first. */
  deferred: AdaptiveQuestion[];
  /** Oldest deferred question, or undefined when nothing is parked. */
  head: AdaptiveQuestion | undefined;
  /** Whether the pool still holds a question that has never been served. */
  hasUnseen: boolean;
  /** Draw an unseen question, preferring `difficulty`; null when the pool is dry. */
  fetchQuestion: (difficulty: Difficulty) => AdaptiveQuestion | null;
  /** Seconds already spent on `questionId` before it was postponed. */
  carriedFor: (questionId: string) => number;
  /** Put `question` on screen as the next one. */
  advance: (question: AdaptiveQuestion) => void;
  /** Park `question` at the back of the FIFO, banking `seconds` already spent. */
  park: (question: AdaptiveQuestion, seconds: number) => void;
  /** Drop the head of the FIFO (it is being served now). */
  dropHead: () => void;
}

/**
 * Where a run STARTS — a fresh simulado (`questions: [first]`, empty FIFO) or a
 * resumed one (the whole served list, its cursor and the parked FIFO).
 *
 * Seeded through `useState` initialisers rather than a `start()`/`resume()`
 * call, because the board reads `questions[currentIndex]` on its FIRST render:
 * seeding with a setter would have to run DURING that render (an effect paints
 * an empty simulado first), and a render-phase update leaves the current pass
 * to finish against an empty list. The board is mounted with a `key` per run,
 * so "initial state" is exactly the right seam — a new run is a new mount.
 */
export interface AdaptivePoolInit {
  /** The CANDIDATE pool, always freshly drawn — never persisted (D8). */
  pool: AdaptiveQuestion[];
  /** The questions SERVED; holds a duplicate when a parked one came back. */
  questions: AdaptiveQuestion[];
  /** A position in `questions` — never an id, which may appear twice. */
  currentIndex: number;
  /** The "Responder depois" FIFO, oldest first (BR-03.1). */
  deferred: AdaptiveQuestion[];
}

export function useAdaptivePool(init: AdaptivePoolInit): AdaptivePool {
  const [questionPool] = useState<AdaptiveQuestion[]>(init.pool);
  const [questions, setQuestions] = useState<AdaptiveQuestion[]>(init.questions);
  const [currentIndex, setCurrentIndex] = useState(init.currentIndex);
  const [deferred, setDeferred] = useState<AdaptiveQuestion[]>(init.deferred);
  // Time already spent on postponed questions, keyed by question id and
  // re-added when the question is finally answered.
  const carriedTimeRef = useRef<Map<string, number>>(new Map());

  const fetchQuestion = useCallback(
    (difficulty: Difficulty): AdaptiveQuestion | null => {
      const answeredIds = questions.map((q) => q.id);
      const unseen = questionPool.filter((q) => !answeredIds.includes(q.id));
      const atDifficulty = unseen.filter((q) => q.difficulty === difficulty);
      const fromPool = atDifficulty.length > 0 ? atDifficulty : unseen;
      if (fromPool.length === 0) return null;
      return fromPool.at(Math.floor(Math.random() * fromPool.length)) ?? null;
    },
    [questionPool, questions],
  );

  // Same "unseen" predicate as `fetchQuestion`, without the random draw — safe
  // to evaluate during render (a draw here would not be the one actually served).
  const seenIds = new Set(questions.map((q) => q.id));
  const hasUnseen = questionPool.some((q) => !seenIds.has(q.id));

  const carriedFor = (questionId: string): number => carriedTimeRef.current.get(questionId) ?? 0;

  return {
    questions,
    currentIndex,
    deferred,
    head: deferred.at(0),
    hasUnseen,
    fetchQuestion,
    carriedFor,
    advance: (question) => {
      setQuestions((prev) => [...prev, question]);
      setCurrentIndex((prev) => prev + 1);
    },
    park: (question, seconds) => {
      carriedTimeRef.current.set(question.id, carriedFor(question.id) + seconds);
      setDeferred((prev) => [...prev, question]);
    },
    dropHead: () => { setDeferred((prev) => prev.slice(1)); },
  };
}
