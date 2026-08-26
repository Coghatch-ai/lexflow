// app/src/shared/lib/run-claimless.ts
//
// ONE concept, one file: what to do about a run this tab persisted but cannot
// CLAIM (epic #67 / #79). It has a single cause at both ends of the run — a
// write that COMMITTED server-side and whose response never came back, so
// `token` stays null while the row is alive on `(user_id, mode)`:
//
//   - the RECORD path (`needsClaimlessProbe` / `claimlessVerdictFor`): the exit
//     is about to record with no claim, which would leave that row alive on top
//     of the session — a double settlement in the prova real (BR-05.7).
//   - the SAVE path (`needsClaimlessSaveProbe` / `claimlessSaveAdoption` /
//     `saveRun`): every retry goes out as another `token: null`, which the
//     router reads as "first save" and refuses with `OVERWRITE_CONFLICT` — the
//     student retries forever against a row THIS TAB wrote.
//
// They are deliberately neighbours rather than two mechanisms in two files:
// the fail-closed direction is the same in both (`read: false` ⇒ do nothing),
// and only the terminal move differs (do not record vs. adopt and carry on).
//
// Pure, like `run-persistence.ts` it builds on: no React, no tRPC, so the whole
// loop — save, lost response, retry — is provable with plain vitest.

import {
  claimFor,
  isConflictError,
  type ClaimOutcome,
  type DraftClaim,
  type PersistedDraft,
  type RunDraftPayload,
} from "./run-persistence";
import type { AnswerDraft, RunMode } from "@shared/domain/exam-draft";

/**
 * Whether a claimless recording must be checked against the server FIRST.
 *
 * "No token" is only evidence that no save RESOLVED here — it is not evidence
 * that no row exists. The save that created the row can commit and have its
 * response lost (timeout, dropped connection): the token stays null, `dirty`
 * goes back to false, and `claimOutcomeFor` says "record with no claim at all"
 * about a run that IS on the server. In the prova real that is the one thing
 * this slice forbids (`real-exam-board.tsx` header): `sessions.record` accepts
 * a claimless payload, writes the session, leaves the orphan row alive on top
 * of it, and the next lazy settlement (`users.me` / `list` / `startReal`)
 * records a SECOND session with duplicated `user_answers` and SM-2 applied
 * twice (BR-05.7).
 *
 * Only the prova real: it is the only mode a SERVER settles on its own, so it
 * is the only one where an orphan row turns into a second session. Everywhere
 * else the orphan is at worst an unwanted "Continuar".
 */
export function needsClaimlessProbe(mode: RunMode, outcome: ClaimOutcome): boolean {
  return mode === "real" && outcome.ok && outcome.claim === undefined;
}

/** What to do about a claimless run once the server's row has been read. */
export type ClaimlessVerdict = "record" | "conflict" | "retry";

/**
 * The verdict on that probe. FAIL-CLOSED in both directions:
 *
 * - a row came back → the run IS persisted and this tab cannot claim it. Same
 *   treatment as a CONFLICT — terminal, nothing written — because the server
 *   will settle that row itself and writing here would be the twin.
 * - the read failed (`read: false`) → we do not know, so we do not write. The
 *   run stays on screen and closing the message is the retry.
 * - no row → nothing to orphan: the claimless recording is the normal path
 *   for a run that was never persisted.
 */
export function claimlessVerdictFor({
  read,
  row,
}: {
  read: boolean;
  row: PersistedDraft | null;
}): ClaimlessVerdict {
  if (!read) return "retry";
  return row === null ? "record" : "conflict";
}

/**
 * The SAVE-path twin of `needsClaimlessProbe` (audit of #79), same cause, other
 * end of the run: a save that carried no token created the row server-side and
 * its response was lost. `token` stays null, so every retry is another
 * `token: null` — which the router reads as "first save" and refuses with
 * `OVERWRITE_CONFLICT` (`onConflictDoNothing` + CONFLICT). The student retries
 * forever against their own row, and a prova real's row then goes stale until
 * `settleRealRun` calls the exam abandoned.
 *
 * A CONFLICT is excluded on purpose: the server ANSWERED, so nothing is
 * unknown — the row pre-existed this save (BR-05.8, a run born on another
 * device) and it must get its dialog, never an adoption.
 */
export function needsClaimlessSaveProbe(hadToken: boolean, error: unknown): boolean {
  return !hadToken && !isConflictError(error);
}

/** The fields of a save that a row written BY that save echoes back verbatim. */
function saveEcho(run: {
  questionIds: readonly string[];
  cursor: number;
  answers: readonly AnswerDraft[];
}): string {
  // Field by field, never `JSON.stringify` of the objects: `answers` makes a
  // jsonb round trip and jsonb does not preserve key order.
  const answers = run.answers.map(
    (a) => `${a.questionId}|${a.userAnswer}|${String(a.correct)}|${String(a.timeSpent)}`,
  );
  return [run.questionIds.join(","), String(run.cursor), answers.join(",")].join("/");
}

/**
 * The claim this tab may adopt after a claimless save whose response was lost,
 * or null to let the original failure stand.
 *
 * WHY ADOPTING IS SAFE HERE, when `adoptableDraftId` refuses: that helper
 * proves ownership by the TOKEN, and the token is exactly what was never
 * learned — so ownership is proven by the CONTENT instead. `exam_drafts` is
 * UNIQUE on `(user_id, mode)` and the read is already user-scoped, so the probe
 * can only ever return the single row of THIS student in THIS mode; and a row
 * whose frozen queue, cursor and answers are a verbatim echo of the payload we
 * just sent IS the row that payload wrote. Nothing else produces it: an
 * independent run on another device draws its own queue and spends its own
 * `timeSpent` seconds.
 *
 * The other way to resolve the ambiguity — adopt ANY row found — was rejected.
 * A lost response can just as well have been a lost `OVERWRITE_CONFLICT`, and
 * adopting there hands this tab a token for a live run it never wrote, whose
 * next save silently bulldozes it. That is exactly what BR-05.8 exists to
 * stop. Refusing costs nothing by comparison: the error stands, the next
 * debounce retries claimlessly, and the server answers the REAL conflict —
 * which is the dialog the student should have been shown anyway.
 *
 * `read: false` (the probe itself failed) is a refusal for the same reason it
 * is in `claimlessVerdictFor`: we do not know, so we do not act.
 */
export function claimlessSaveAdoption(
  probe: { read: boolean; row: PersistedDraft | null },
  sent: RunDraftPayload,
): DraftClaim | null {
  if (!probe.read || probe.row === null) return null;
  if (probe.row.mode !== sent.mode) return null;
  if (saveEcho(probe.row) !== saveEcho(sent)) return null;
  // The token comes off the row VERBATIM, so the optimistic guard is fully
  // armed again from the very next write: a row that somehow was not ours
  // costs ONE save and then raises the honest "continuado em outro aparelho".
  // `?? null` because `claimFor` refuses an empty id or token: a half-built
  // claim is not an adoption, and the caller must see the refusal as one.
  return claimFor(probe.row.id, probe.row.lastSavedAt) ?? null;
}

/** What one save landed: the new token, and the id if it had to be recovered. */
export interface SavedRun {
  lastSavedAt: string;
  /** Non-null ONLY when the row was adopted after a lost response. */
  draftId: string | null;
}

/** The two calls `saveRun` needs — the mutation, and the user-scoped re-read. */
export interface SaveRunIO {
  save: (payload: RunDraftPayload) => Promise<{ lastSavedAt: string }>;
  probe: () => Promise<{ read: boolean; row: PersistedDraft | null }>;
}

/**
 * One save, with the lost-response recovery around it (#79). A pure
 * orchestration over two injected calls rather than logic inside the hook, so
 * the whole loop is provable without React.
 *
 * Rethrows the original error whenever it did NOT adopt: a dropped request is
 * retried by the next debounce (`save-scheduler.ts` re-arms `dirty`) and a
 * CONFLICT still stops the autosave and raises its dialog. Only a proven echo
 * of our own write turns the failure into the success it actually was.
 */
export async function saveRun(sent: RunDraftPayload, io: SaveRunIO): Promise<SavedRun> {
  try {
    const saved = await io.save(sent);
    return { lastSavedAt: saved.lastSavedAt, draftId: null };
  } catch (error: unknown) {
    if (!needsClaimlessSaveProbe(sent.token !== null, error)) throw error;
    const adopted = claimlessSaveAdoption(await io.probe(), sent);
    if (adopted === null) throw error;
    return { lastSavedAt: adopted.lastSavedAt, draftId: adopted.id };
  }
}
