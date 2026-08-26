// The three once-per-run moments of the Simulado Real (BR-05.5, epic #67 slice
// S2d): adopting the row a reload rehydrated from, the FIRST save of a fresh
// run, and the auto-submit the deadline fires.
//
// All three are guarded by a REF rather than by a dependency list, and that is
// the whole reason they are worth a file: each of them must happen exactly once
// per mount, a hand-maintained dep array is what silently makes it twice, and a
// second `processReal` for one run is a second settlement. Extracted from
// `real-exam-board.tsx` for the same reason as the clock hooks — the board is
// at its `max-lines-per-function` budget and these are its most mechanical
// lines.

import { useEffect, useRef } from "react";

/**
 * Takes ownership of the row a resume rehydrated from — DURING RENDER, on
 * purpose. It is a ref write that paints nothing, and doing it in an effect
 * would let a re-run overwrite a fresher token with the one this mount started
 * from.
 */
export function useAdoptedDraft(
  draft: { id: string; token: string } | null,
  adopt: (draftId: string, token: string) => void,
): void {
  const adopted = useRef(false);
  if (!adopted.current) {
    adopted.current = true;
    if (draft !== null) adopt(draft.id, draft.token);
  }
}

/**
 * The first save of a fresh run, which is what writes `deadline_at`. Without it
 * an exam abandoned before the first answer leaves no row to settle, and the
 * deadline the auto-submit is judged against never exists.
 */
export function useFirstSave(needed: boolean, scheduleSave: () => void): void {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (needed) scheduleSave();
  });
}

/**
 * The auto-submit the deadline fires, exactly once.
 *
 * `blocked` carries the board's own reasons to wait (already reviewing, or an
 * exit already in flight): the student can click "Encerrar" with a second left
 * and have the deadline pass while that flush is still in the air. The draft
 * DELETE would de-duplicate the two, but they would fight over one claim and
 * the loser would raise a CONFLICT for a run that ended perfectly normally. If
 * that manual exit then FAILS, `blocked` clears and this fires — the deadline
 * has passed, so settling is exactly right.
 *
 * No dependency array, by design: the ref is the guard, and the effect re-runs
 * per render so it always calls the CURRENT `submit`, never a captured one.
 */
export function useDeadlineAutoSubmit({
  blocked,
  secondsLeft,
  submit,
}: {
  blocked: boolean;
  secondsLeft: number;
  submit: () => Promise<void>;
}): void {
  const submitted = useRef(false);
  useEffect(() => {
    if (blocked || submitted.current || secondsLeft > 0) return;
    submitted.current = true;
    void submit();
  });
}
