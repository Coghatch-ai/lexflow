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
// The save path also owns the BOUND on that write (`SAVE_TIMEOUT_MS`), because
// a request that stalls is the same event as one whose response was dropped —
// and only the module holding the payload can tell the row it wrote from a
// stranger's. Bounding it from the cadence layer instead was the regression
// this file's third round exists to undo (see `saveRun`).
//
// They are deliberately neighbours rather than two mechanisms in two files:
// the fail-closed direction is the same in both (`read: false` ⇒ do nothing),
// and only the terminal move differs (do not record vs. adopt and carry on).
//
// Pure, like `run-persistence.ts` it builds on: no React, no tRPC, so the whole
// loop — save, lost response, retry — is provable with plain vitest.

import { boundedCall } from "./settle-within";
import {
  claimFor,
  type ClaimOutcome,
  type DraftClaim,
  type PersistedDraft,
  type RunDraftPayload,
} from "./run-persistence";
import { timestampMs, type RunMode } from "@shared/domain/exam-draft";

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
 * its response was lost (dropped, or bounded away by `SAVE_TIMEOUT_MS`).
 * `token` stays null, so every retry is another `token: null` — which the
 * router reads as "first save" and refuses with `OVERWRITE_CONFLICT`
 * (`onConflictDoNothing` + CONFLICT). The student retries forever against their
 * own row, and a prova real's row then goes stale until `settleRealRun` calls
 * the exam abandoned.
 *
 * A CONFLICT used to be excluded here — "the server ANSWERED, so nothing is
 * unknown". That reading was wrong for a CLAIMLESS save, and it is the last
 * link of the Codex chain (`exam-drafts.router.ts` `save`): with `token: null`
 * the router's CONFLICT says only "a row exists on (user_id, mode)". It does
 * NOT say whose. This tab's own timed-out first write produces exactly that
 * row, so treating the answer as terminal makes the student collide with
 * themselves — the one collision a prova real can never recover from, since
 * `raiseIfConflict` closes the scheduler for good.
 *
 * So the CONFLICT stops being terminal by ASSUMPTION and becomes terminal by
 * PROOF: it is probed, and `claimlessSaveAdoption` adopts only a row that
 * echoes back every field this payload sent. No echo ⇒ the original CONFLICT
 * stands untouched and gets its BR-05.8 dialog ("continuado em outro
 * aparelho"), which is the fail-closed half this file has everywhere.
 *
 * A save that CARRIED a token is untouched: its CONFLICT is a real lost race
 * on `last_saved_at`, ownership was already proven by the token, and there is
 * nothing to discover by reading the row again.
 */
export function needsClaimlessSaveProbe(hadToken: boolean): boolean {
  return !hadToken;
}

/**
 * Every key ANY save payload carries. Distributive on purpose: a bare
 * `keyof RunDraftPayload` is the INTERSECTION of the four members' keys, which
 * silently drops the per-mode ones (`deadlineAt` exists only on the real
 * payload) — exactly the drift this type exists to prevent.
 */
type SavePayloadKey<T = RunDraftPayload> = T extends unknown ? keyof T : never;

/**
 * Compile-time assertion that an echoed field also EXISTS on the row: there is
 * nothing to compare a payload field against if `examDrafts.get` does not
 * return it. A payload field the row lacks fails this constraint instead of
 * being quietly skipped.
 */
type OnRow<K extends keyof PersistedDraft> = K;

/**
 * The fields compared VERBATIM, as a key union rather than a hand-kept list:
 * everything a save sends, minus the two that a row cannot echo back.
 *
 * - `token` is what the save SENT (the previous `last_saved_at`, null on a
 *   first save); the row answers with the NEW one. Never the same string by
 *   definition — comparing it would refuse every true echo.
 * - `deadlineAt` is compared by INSTANT below, not verbatim: `examDrafts.save`
 *   normalises it through `deadlineAtInput`'s `.transform` (ISO, µs truncated
 *   to ms) and the row comes back as raw PG text (`"… 14:30:04.210000+00"`, no
 *   `T`, no `Z`), so the bytes legitimately differ for one and the same
 *   instant. It is compared, never skipped.
 */
type EchoedKey = OnRow<Exclude<SavePayloadKey, "token" | "deadlineAt">>;

/** Anything carrying the echoed fields — both a sent payload and a read row. */
type EchoSource = Record<EchoedKey, unknown>;

/** JSON with object keys sorted at every depth: `answers`, `setup` and
 * `modeState` make a jsonb round trip and jsonb does not preserve key order,
 * so a raw `JSON.stringify` would call our own write foreign. Array order is
 * preserved — the queue order IS progress (BR-03). */
function canonicalJson(value: Record<string, unknown>): string {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  // Always a string: the argument is an object, the one input `JSON.stringify`
  // never answers `undefined` for.
  return JSON.stringify(value, (_key: string, member: unknown) =>
    isRecord(member)
      ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a.localeCompare(b)))
      : member,
  );
}

/**
 * The fields of a save that a row written BY that save echoes back verbatim.
 *
 * The literal is typed `Record<EchoedKey, unknown>` so the COMPILER keeps this
 * exhaustive: add a field to any save payload and this object stops building
 * ("Property 'x' is missing") until it is either compared here or explicitly
 * excluded from `EchoedKey` with a reason. A hand-maintained subset was the
 * bug — `deadlineAt`, `modeState` and `elapsedSeconds` were never compared, so
 * a row differing on exactly those was adopted as ours.
 */
function saveEcho(source: EchoSource): string {
  const echoed: Record<EchoedKey, unknown> = {
    mode: source.mode,
    setup: source.setup,
    questionIds: source.questionIds,
    cursor: source.cursor,
    answers: source.answers,
    modeState: source.modeState,
    elapsedSeconds: source.elapsedSeconds,
  };
  return canonicalJson(echoed);
}

/**
 * The deadline of a payload: absent on the study modes, which is the same
 * thing as the `null` the column holds for them.
 */
function sentDeadline(sent: RunDraftPayload): string | null {
  return "deadlineAt" in sent ? sent.deadlineAt : null;
}

/**
 * Whether the row's deadline is the one this save sent — by instant, because
 * this is the ONE field the server rewrites on the way in (see `EchoedKey`).
 *
 * FAIL-CLOSED, like every other decision in this file: a value neither side
 * can read strictly (`timestampMs`, never `Date.parse`) is not a match. Both
 * null — every study mode — is a match: nothing was sent, nothing was stored.
 */
function sameDeadline(row: string | null, sent: string | null): boolean {
  if (row === null || sent === null) return row === sent;
  const stored = timestampMs(row);
  const asked = timestampMs(sent);
  return stored !== null && stored === asked;
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
 * that echoes back EVERY field the payload sent IS the row that payload wrote.
 * Nothing else produces it: an independent run on another device draws its own
 * queue and spends its own `timeSpent` seconds.
 *
 * Every field, not a subset (Codex audit of #79): the proof used to read only
 * `mode` + queue + cursor + answers, so a same-mode row differing on
 * `deadlineAt`, `modeState` or `elapsedSeconds` — a live prova real started on
 * another device, minutes apart — passed as ours and its next save bulldozed
 * it. `saveEcho` is now compiler-exhaustive over the payload keys and
 * `sameDeadline` covers the one field the server rewrites, so a field added to
 * a save payload cannot escape the check by being forgotten here.
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
  if (saveEcho(probe.row) !== saveEcho(sent)) return null;
  if (!sameDeadline(probe.row.deadlineAt, sentDeadline(sent))) return null;
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
 * How long ONE save may stay in the air before this module calls it lost.
 *
 * The bound lives HERE, not in `save-scheduler.ts`, and that is the whole fix
 * of the third Codex round. A bound in `dispatch` abandons the request from
 * outside: the scheduler holds no payload, so a write that timed out and then
 * COMMITTED was indistinguishable from one that never landed — `dirty` was
 * re-armed, the retry went out as another `token: null`, and the router
 * answered `OVERWRITE_CONFLICT` against the student's own abandoned write,
 * terminally. Inside `saveRun` the timeout is just another lost response, and
 * the probe below compares the row against THE VERY PAYLOAD that timed out,
 * which is the only moment the echo can prove ownership: one beat later the
 * payload has moved on (a new answer, a new cursor) and no row would ever match
 * it again.
 *
 * 15 s, so that 15 + `PROBE_TIMEOUT_MS` stays under the scheduler's 30 s
 * backstop and the recovery always runs before the slot is torn out from under
 * it. Tripping early is cheap: the probe either proves the row is ours (one
 * read, and the token is learned) or refuses, and the write is owed again.
 */
export const SAVE_TIMEOUT_MS = 15_000;

/**
 * The recovery read's own bound: the probe is a single user-scoped `get`, and a
 * probe that hangs would hold the slot exactly like the write it came to
 * rescue. Unread is never taken for "no row" (`read: false`), so the timeout is
 * a refusal, never an adoption.
 */
export const PROBE_TIMEOUT_MS = 5_000;

/** The probe, bounded and fail-closed: silence and failure both read as unknown. */
async function probeWithin(io: SaveRunIO): Promise<{ read: boolean; row: PersistedDraft | null }> {
  try {
    return await boundedCall(io.probe(), PROBE_TIMEOUT_MS);
  } catch {
    return { read: false, row: null };
  }
}

/**
 * One save, BOUNDED, with the lost-response recovery around it (#79). A pure
 * orchestration over two injected calls rather than logic inside the hook, so
 * the whole loop — save, silence, probe, adoption — is provable without React.
 *
 * The three ways a claimless save can fail are ONE case here, because they are
 * one case on the server: the row may or may not exist, and only its content
 * says whose it is. A dropped response, a request that never answers
 * (`SAVE_TIMEOUT_MS`) and an `OVERWRITE_CONFLICT` all lead to the same probe.
 *
 * Rethrows the original error whenever it did NOT adopt: a dropped request is
 * retried by the next debounce (`save-scheduler.ts` re-arms `dirty`) and an
 * unproven CONFLICT still stops the autosave and raises its dialog. Only a
 * proven echo of our own write turns the failure into the success it was.
 */
export async function saveRun(sent: RunDraftPayload, io: SaveRunIO): Promise<SavedRun> {
  try {
    const saved = await boundedCall(io.save(sent), SAVE_TIMEOUT_MS);
    return { lastSavedAt: saved.lastSavedAt, draftId: null };
  } catch (error: unknown) {
    if (!needsClaimlessSaveProbe(sent.token !== null)) throw error;
    const adopted = claimlessSaveAdoption(await probeWithin(io), sent);
    if (adopted === null) throw error;
    return { lastSavedAt: adopted.lastSavedAt, draftId: adopted.id };
  }
}
