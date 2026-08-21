// api/lib/record-session.ts
//
// The ONE write path for a finished study session. Moved verbatim out of
// sessions.router.ts (behaviour unchanged) so that BOTH entry points share it:
//
//   1. sessions.record — the student ends the run in the browser;
//   2. settleRealRun   — the server settles an abandoned prova real.
//
// Two entry points, one body: there is no parallel recording path that could
// skip SM-2, skip the answer rows, or leave the in-flight `exam_drafts` row
// behind. When a `DraftClaim` is supplied the draft row is DELETED as the FIRST
// statement of the transaction, `RETURNING id`, and zero rows aborts the whole
// transaction (`DraftAlreadyConsumedError`). That ordering is what makes the
// delete a real mutex between the client (timer hits zero) and the server (lazy
// settlement), and between two concurrent settlements: the second transaction
// blocks on the row lock the first one holds, then re-checks, finds the row
// gone, deletes 0 rows and rolls back BEFORE writing anything. Deleting last and
// ignoring the row count (the shape review #75 rejected) lets both commit —
// 2 study_sessions, duplicated user_answers (no unique constraint stops them)
// and SM-2 advanced twice (upsertSm2States reads-and-writes; not idempotent).

import { and, eq, sql } from "drizzle-orm";
// Type-only: this module never opens the transaction, it runs inside one.
import type { db } from "../db/client";
import { studySessions, examDrafts, userAnswers } from "../../drizzle/schema";
import { upsertSm2States } from "./sm2";
import type { Sm2Config } from "../../shared/domain/spaced-repetition";
import type { AnswerDraft } from "../../shared/domain/exam-draft";

/** Transaction handle, as drizzle types it for `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The claim matched no row: the draft was already consumed by a concurrent
 * recorder, OR it moved on (another tab saved/touched it, so the token this
 * caller carried is stale). Either way the transaction rolled back and NOTHING
 * was written. It is a benign race, not a bug: the run is safe — already a
 * session, or still live with fresher answers than the caller had. Callers
 * decide how to answer it (settleRealRun: "not settled"; sessions.record:
 * CONFLICT), which is why it is a named class and not a bare Error.
 */
export class DraftAlreadyConsumedError extends Error {
  constructor(draftId: string) {
    super(`exam draft ${draftId} was already consumed by a concurrent recorder`);
    this.name = "DraftAlreadyConsumedError";
  }
}

/**
 * The in-flight draft this recording consumes — AND the terms on which it may
 * be consumed. The two variants are ONE type on purpose: an id can never travel
 * without saying what it expects the row's state to be.
 *
 *   `{ id, lastSavedAt }` — the normal claim. `lastSavedAt` is the `last_saved_at`
 *     the caller BASED ITS DECISION ON (the same optimistic token
 *     `examDrafts.save`/`touch` use). The claiming delete only matches while the
 *     row still carries it, so a run that MOVED between the caller's read and
 *     this transaction — another tab saved, the student came back, the heartbeat
 *     landed — is not force-submitted with the caller's older answers: 0 rows ⇒
 *     `DraftAlreadyConsumedError`, exactly like losing the race.
 *
 *   `{ id, force: true }` — claim the row whatever its state. ONE caller is
 *     entitled to it: `examDrafts.startReal`, where BR-05.5 says asking for a
 *     new prova real settles the pending one however fresh it is (token-guarding
 *     it would let a heartbeat strand the student behind an old real draft that
 *     has no resume/discard path). It is a separate variant, and not an omitted
 *     field, because an UNCONDITIONAL claim must be a deliberate word in the
 *     source — an optional token is claimed unconditionally by forgetting it,
 *     which is the exact shape review #80 rejected on the browser path.
 */
export type DraftClaim = { id: string; lastSavedAt: string } | { id: string; force: true };

export type RecordSessionInput = {
  discipline: string;
  difficulty: "easy" | "medium" | "hard";
  /** At least one; blank answers are filtered out BEFORE this call. */
  answers: AnswerDraft[];
  /** In-flight exam draft to consume, deleted inside this transaction. */
  draft?: DraftClaim | undefined;
};

/**
 * Consumes the in-flight draft when one was given (first statement — see the
 * file header), then writes the session, its answers and the SM-2 state inside
 * `tx`. Returns the new study_sessions id. Throws `DraftAlreadyConsumedError`
 * (transaction rolled back, nothing written) when the draft is already gone.
 *
 * `sm2Config` is a parameter (not loaded here) on purpose: the connection pool
 * is `max: 1` (one Lambda request = one connection), so any query issued on
 * `db` while this transaction is open would deadlock. Load it before opening
 * the transaction, exactly as sessions.record always has.
 */
export async function recordSession(
  tx: Tx,
  userId: string,
  input: RecordSessionInput,
  sm2Config: Sm2Config,
): Promise<string> {
  const total = input.answers.length;
  const correct = input.answers.filter((a) => a.correct).length;

  // FIRST statement: claim the run by deleting it. Scoped by user_id so a forged
  // id cannot consume another student's draft, and — unless the caller asked for
  // the `force` variant — by `last_saved_at`, so the claim only lands on the row
  // the caller actually judged. 0 rows ⇒ someone else recorded this run, or it
  // moved on (another tab saved, the student came back) — abort before a single
  // write lands.
  const claim = input.draft;
  if (claim !== undefined) {
    const [claimed] = await tx
      .delete(examDrafts)
      .where(
        and(
          eq(examDrafts.id, claim.id),
          eq(examDrafts.userId, userId),
          "force" in claim ? undefined : eq(examDrafts.lastSavedAt, claim.lastSavedAt),
        ),
      )
      .returning({ id: examDrafts.id });
    if (claimed === undefined) throw new DraftAlreadyConsumedError(claim.id);
  }

  const [session] = await tx
    .insert(studySessions)
    .values({
      userId,
      discipline: input.discipline,
      difficulty: input.difficulty,
      totalQuestions: total,
      correctAnswers: correct,
      endedAt: sql`now()`,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .returning({ id: studySessions.id });
  if (session === undefined) throw new Error("study_session insert returned no row");

  await tx.insert(userAnswers).values(
    input.answers.map((a) => ({
      userId,
      questionId: a.questionId,
      userAnswer: a.userAnswer,
      correct: a.correct,
      timeSpent: a.timeSpent,
      createdBy: userId,
      lastUpdBy: userId,
    })),
  );

  await upsertSm2States(tx, userId, input.answers, sm2Config);

  return session.id;
}
