// The two per-question MARKS of the Simulado Real (BR-02/BR-03, epic #67 slice
// S2d): "sinalizar para revisar" and "responder depois".
//
// Neither is progress and neither is persisted (D8): they are how the student
// navigates the 80 questions inside this tab, so a reload legitimately starts
// with a clean board. That is exactly why they live here and not in the draft
// payload — grouping them keeps the board's own state to the things a run is
// actually made of (answers, cursor, eliminations).
//
// Kept out of `real-exam-board.tsx` for the same reason as the clock hooks: the
// board is at the `max-lines-per-function` budget, and four setter closures over
// two `Set`s are the least interesting lines in it.

import { useState } from "react";

export interface RealExamMarks {
  /** Indexes flagged for review — a count in the header, a filled icon. */
  flagged: Set<number>;
  /** Indexes parked by "Responder depois" (BR-03). */
  postponed: Set<number>;
  /** Flag / unflag one index. */
  toggleFlag: (index: number) => void;
  /** Park one index. */
  postpone: (index: number) => void;
  /** Un-park one index — answering it is what un-parks it (BR-03.2). */
  unpostpone: (index: number) => void;
}

const EMPTY = (): Set<number> => new Set<number>();

/** A new `Set` per change, never a mutation: the screens re-render off these. */
function withToggled(previous: Set<number>, index: number): Set<number> {
  const next = new Set(previous);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function useRealExamMarks(): RealExamMarks {
  const [flagged, setFlagged] = useState<Set<number>>(EMPTY);
  const [postponed, setPostponed] = useState<Set<number>>(EMPTY);

  return {
    flagged,
    postponed,
    toggleFlag: (index: number): void => {
      setFlagged((previous) => withToggled(previous, index));
    },
    postpone: (index: number): void => {
      setPostponed((previous) => new Set(previous).add(index));
    },
    unpostpone: (index: number): void => {
      // The identity check keeps an answered-but-never-postponed question from
      // re-rendering the whole 80-question nav on every single answer.
      setPostponed((previous) => (previous.has(index) ? withToggled(previous, index) : previous));
    },
  };
}
