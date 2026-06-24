// apps/mobile/src/state/practice-context.ts
//
// Shared practice-flow state: the chosen discipline (Home -> Practice) and the
// finished session summary (Practice -> Result). Wouter has no route-state, so
// these ride a context instead of the URL. Context + hook live here (no JSX);
// the provider component lives in practice-state.tsx.

import { createContext, useContext } from "react";

export type Difficulty = "easy" | "medium" | "hard";

// A session is either fresh practice (questions picked by discipline) or a
// spaced-repetition review (questions pulled from the due queue). Both run the
// same QuestionRunner UI and record via sessions.record; the tag only changes
// the Result screen wording.
export type PracticeMode = "practice" | "review";

export type AnswerRecap = {
  questionId: string;
  questionText: string;
  options: string[];
  userAnswer: string;
  correctAnswer: string;
  correct: boolean;
};

export type PracticeResult = {
  discipline: string;
  difficulty: Difficulty;
  mode: PracticeMode;
  totalQuestions: number;
  correctAnswers: number;
  recap: AnswerRecap[];
};

export type PracticeState = {
  discipline: string;
  setDiscipline: (d: string) => void;
  result: PracticeResult | null;
  setResult: (r: PracticeResult | null) => void;
};

export const PracticeContext = createContext<PracticeState | null>(null);

export function usePracticeState(): PracticeState {
  const ctx = useContext(PracticeContext);
  if (ctx === null) {
    throw new Error("usePracticeState must be used within PracticeStateProvider");
  }
  return ctx;
}
