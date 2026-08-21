// api/lib/settle-real-run.ts
//
// LAZY settlement of an abandoned prova real (BR-05.5, epic #67 D4).
//
// There is no scheduler in this project (Lambda behind API Gateway — no
// EventBridge, no cron), so "the student closed the tab" is not detected in
// real time. It is settled on the student's NEXT authenticated contact, from
// exactly three call sites, all of which land here:
//
//   users.me             — first call of any session ("came back to the product")
//   examDrafts.list      — the mode-selection screen
//   examDrafts.startReal — asking for a new prova real settles the old one
//                          unconditionally (force): a real exam is NEVER offered
//                          back (BR-05.5)
//
// The prova real is also settled by the client itself when the timer hits zero
// (examDrafts.processReal) — same helper, same body.
//
// CONCURRENCY: the read below is NOT the guard. Two settlements (users.me and
// examDrafts.list on one page render, two tabs, or the client's processReal
// against a lazy server settlement) can both read the same row and both start
// recording. The de-duplicator is the delete inside the recording transaction
// (api/lib/record-session.ts): it is the FIRST statement, it returns the row it
// claimed, and 0 rows rolls the whole transaction back with
// DraftAlreadyConsumedError. Here that error is the "someone else settled it"
// answer, not a failure — one run ⇒ exactly one study_sessions row (BR-05.7).
//
// STALENESS: de-duplicating is not enough on its own. The claim must also land
// on the row this call actually JUDGED — between the read and the delete, a
// `save`/`touch` from the student's own tab can refresh the same row, i.e. the
// student came BACK, and an unconditional delete would then force-submit a LIVE
// exam and destroy the in-flight run. So the claim carries `last_saved_at` as an
// optimistic token (the very token `examDrafts.save`/`touch` already use): a
// refreshed row matches 0 rows and answers NOT_SETTLED, exactly like losing the
// race. `force` (startReal) deliberately skips the token — BR-05.5 says asking
// for a new prova real settles the old one however fresh it is.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { examDrafts, oabQuestions } from "../../drizzle/schema";
import { loadSm2Config } from "./sm2";
import { DraftAlreadyConsumedError, recordSession } from "./record-session";
import { answersForRecord, isRealRunAbandoned, reconcileRun } from "../../shared/domain/exam-draft";

/** What the abandoned prova real is filed under — identical to what the browser
 * sends today from RealExamSimulation, so both paths produce the same session. */
const REAL_EXAM_DISCIPLINE = "Prova Real";
const REAL_EXAM_DIFFICULTY = "hard" as const;

export type SettleResult = {
  /** A draft existed and was consumed (recorded and/or deleted). */
  settled: boolean;
  /** The session created, or null when the draft had nothing to record. */
  sessionId: string | null;
};

const NOT_SETTLED: SettleResult = { settled: false, sessionId: null };

/**
 * Settles the user's prova real if it was abandoned. `force` settles it no
 * matter how fresh it is — that is the "start a new prova real" trigger.
 *
 * With ≥1 answer: reconciles against the live catalog (a question that left
 * `oab_questions` would break the `user_answers.question_id` FK and take the
 * transaction down) and records ONE session through the shared path, deleting
 * the draft in the same transaction. With 0 processable answers: the row is
 * deleted and NO session is created — `sessions.record` requires at least one
 * answer, and an untouched exam is not a result.
 */
export async function settleRealRun(
  userId: string,
  { force = false }: { force?: boolean } = {},
): Promise<SettleResult> {
  const [draft] = await db
    .select()
    .from(examDrafts)
    .where(and(eq(examDrafts.userId, userId), eq(examDrafts.mode, "real")))
    .limit(1);
  if (draft === undefined) return NOT_SETTLED;
  return settleReadRealRun(userId, draft, { force });
}

/** The prova real row as read — what the judgement below is made against. */
export type RealRunDraft = typeof examDrafts.$inferSelect;

/**
 * Settles a draft ALREADY READ. Split out of `settleRealRun` so the read and the
 * claim are two visible steps with the row between them — the window the token
 * closes (see STALENESS in the file header), and the seam
 * `scripts/smoke-exam-drafts.ts` uses to hold a stale row across a concurrent
 * `save`/`touch` and prove a returning student is never force-submitted.
 */
export async function settleReadRealRun(
  userId: string,
  draft: RealRunDraft,
  { force = false }: { force?: boolean } = {},
): Promise<SettleResult> {
  const abandoned = isRealRunAbandoned({
    deadlineAt: draft.deadlineAt,
    lastSavedAt: draft.lastSavedAt,
    now: new Date().toISOString(),
  });
  if (!force && !abandoned) return NOT_SETTLED;

  // The token this settlement judged. `force` claims the row whatever its state.
  const expectedToken = force ? undefined : draft.lastSavedAt;

  const survivors = await liveQuestionIds(draft.questionIds);
  const reconciled = reconcileRun(
    { questionIds: draft.questionIds, cursor: draft.cursor, answers: draft.answers },
    survivors,
  );
  const answers = answersForRecord(reconciled);

  if (answers.length === 0) {
    // Same claim rule, cheaper: whoever deletes the row settled it. 0 rows ⇒ a
    // concurrent settlement got there first, or the student came back and moved
    // `last_saved_at` — either way this call settled nothing.
    const [claimed] = await db
      .delete(examDrafts)
      .where(
        and(
          eq(examDrafts.id, draft.id),
          eq(examDrafts.userId, userId),
          expectedToken === undefined ? undefined : eq(examDrafts.lastSavedAt, expectedToken),
        ),
      )
      .returning({ id: examDrafts.id });
    return claimed === undefined ? NOT_SETTLED : { settled: true, sessionId: null };
  }

  const sm2Config = await loadSm2Config();
  try {
    const sessionId = await db.transaction((tx) =>
      recordSession(
        tx,
        userId,
        {
          discipline: REAL_EXAM_DISCIPLINE,
          difficulty: REAL_EXAM_DIFFICULTY,
          answers,
          draftId: draft.id,
          draftLastSavedAt: expectedToken,
        },
        sm2Config,
      ),
    );
    return { settled: true, sessionId };
  } catch (err: unknown) {
    // Lost the race, or the student came back and refreshed the row: either way
    // this transaction wrote NOTHING and the run is untouched. Report "not
    // settled by me" — never a 500.
    if (err instanceof DraftAlreadyConsumedError) return NOT_SETTLED;
    throw err;
  }
}

/** The subset of a draft's queue that still exists in the global catalog. */
async function liveQuestionIds(questionIds: readonly string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: oabQuestions.id })
    .from(oabQuestions)
    .where(inArray(oabQuestions.id, [...questionIds]));
  return new Set(rows.map((r) => r.id));
}
