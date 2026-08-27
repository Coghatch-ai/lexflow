// The Simulado Real's deadline submission (BR-05.5, epic #67 slice S2d): the
// one door with no manual retry behind it, because the clock is at 0 and the
// student cannot press "Encerrar" again.
//
// It is a hook rather than a function on the board for one reason: its two
// outcomes are SCREENS, and each of them is a claim about what happened.
//
//   flush did not land  → `failed`      — the answers never left this tab
//   flush landed, settlement unknown → `unconfirmed` — the answers are safe,
//                                        the result is not known
//   both landed         → neither flag  — the board may show the review
//
// Both awaits are BOUNDED (`settleWithin`, `DEADLINE_SUBMIT_TIMEOUT_MS`): while
// they are in the air the board shows an actionless card, so a request that
// never answers has to become a verdict or that card is where the run ends.
//
// Extracted from `real-exam-board.tsx` for the same reason as the clock and the
// lifecycle hooks: the board is at its `max-lines-per-function` budget, and
// this is the part of it that is a state machine rather than a screen.

import { useState } from 'react';
import {
  DEADLINE_SUBMIT_TIMEOUT_MS,
  PROCESS_REJECTED,
  deadlineCompletionFor,
  deadlineSettlementFor,
} from './real-exam-failures';
import { settleWithin, type Settled } from '../shared/lib/settle-within';

/**
 * `processReal` as one of THREE answers: the settlement itself, `UNSETTLED`
 * (it never came back inside the bound — third audit round of #79, which is
 * what keeps the actionless `submitting` card from lasting as long as a hung
 * request), or `PROCESS_REJECTED` (it threw).
 *
 * Both silences used to collapse into "carry on to the review screen", on the
 * argument that the row is on the server with its deadline in the past, so the
 * next authenticated contact settles it. True about the DATA, and beside the
 * point about the SCREEN (Codex adversarial review of #79): the review screen
 * tells the student their exam is done, which at that moment nobody knows.
 */
async function attempted<T extends object>(
  run: () => Promise<T>,
): Promise<Settled<T> | typeof PROCESS_REJECTED> {
  try {
    return await settleWithin(run(), DEADLINE_SUBMIT_TIMEOUT_MS);
  } catch {
    return PROCESS_REJECTED;
  }
}

export interface DeadlineSubmission {
  /** The flush did NOT land: the answers are still only in this tab. */
  failed: boolean;
  /** The flush landed, the settlement was never confirmed. */
  unconfirmed: boolean;
  /** Run the submission — also what the button on either card re-runs. */
  finish: () => Promise<void>;
}

/**
 * @param flush Land everything pending. `ok: false` is either a real failure or
 *   a CONFLICT, and both mean the same thing here: settle nothing.
 * @param processReal The settlement itself (`examDrafts.processReal`).
 * @param onConfirmed Confirmed and only then: refetch, close the run, show the
 *   review. Deliberately the caller's, because closing the run is what makes
 *   the retry on the other two paths possible.
 */
export function useDeadlineSubmission({
  flush,
  processReal,
  onConfirmed,
  setBusy,
}: {
  flush: () => Promise<{ ok: boolean }>;
  processReal: () => Promise<{ settled: boolean }>;
  onConfirmed: () => void;
  setBusy: (busy: boolean) => void;
}): DeadlineSubmission {
  const [failed, setFailed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const finish = async (): Promise<void> => {
    setBusy(true);
    // A new attempt starts clean: whatever is on screen is about THIS one.
    setFailed(false);
    setUnconfirmed(false);
    const flushed = await settleWithin(flush(), DEADLINE_SUBMIT_TIMEOUT_MS);
    if (deadlineSettlementFor(flushed) === 'hold') {
      setFailed(true);
      setBusy(false);
      return;
    }
    // The answers are on the server from here on. What the settlement adds is
    // the RESULT — and an unknown one may not be painted as a finished exam.
    const processed = await attempted(processReal);
    if (deadlineCompletionFor(processed) === 'unconfirmed') {
      setUnconfirmed(true);
      setBusy(false);
      return;
    }
    onConfirmed();
    setBusy(false);
  };

  return { failed, unconfirmed, finish };
}
