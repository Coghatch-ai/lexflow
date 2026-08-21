// scripts/smoke-exam-drafts-stale.ts
//
// (l) of the `exam_drafts` smoke block (epic #67 S2a, review of PR #80): the
// STALE-READ window on the WRITE path. Lazy settlement reads a prova real,
// judges it abandoned, and only then claims it — and in between, the student can
// come back. Deleting the row unconditionally at that point force-submits a LIVE
// exam and destroys the run. `last_saved_at` is carried into the claim as the
// optimistic token (the same one `save`/`touch` use), so a refreshed row matches
// 0 rows and answers NOT_SETTLED, exactly like losing the race to another
// settlement. Its own file because `smoke-exam-drafts.ts` sits at the max-lines
// cap; the plumbing both use lives in `scripts/lib/smoke-drafts.ts`.

import { and, eq } from "drizzle-orm";
import { settleReadRealRun, settleRealRun } from "../api/lib/settle-real-run";
import { examDrafts, studySessions, userAnswers } from "../drizzle/schema";
import {
  check,
  countRows,
  type SmokeCaller,
  type SmokeDb,
  type SmokeQuestion,
} from "./lib/smoke-drafts";

/** (l) A settlement holding a stale read never force-submits a run the student
 *  came back to: no session is recorded and the draft survives with the answers
 *  just added. The refusal is the TOKEN and not a lockout — the tail lets the
 *  same run go silent again and it settles normally. */
export async function assertStaleSettlementNeverForceSubmits(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first, second] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");

  const sessionsBefore = await countRows(db, studySessions, userId);
  const answersBefore = await countRows(db, userAnswers, userId);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const silent = new Date(Date.now() - 300_000).toISOString(); // 5 min: 3 beats missed

  const answered = [
    { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 30 },
  ];
  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: answered,
    modeState: { mode: "real" },
    elapsedSeconds: 120,
    deadlineAt: future, // hours of exam left — only the silent heartbeat looks dead
    lastSavedAt: silent,
    createdBy: userId,
    lastUpdBy: userId,
  });

  // Exactly what a settlement reads before it decides. Everything below happens
  // inside the window between that read and the claim.
  const [staleDraft] = await db
    .select()
    .from(examDrafts)
    .where(and(eq(examDrafts.userId, userId), eq(examDrafts.mode, "real")))
    .limit(1);
  if (staleDraft === undefined) throw new Error("[smoke] (l) the prova real insert did not land");

  // The student was never gone (tabbed away, phone rang): they answer again.
  const onReturn =
    second === undefined
      ? answered
      : [
          ...answered,
          {
            questionId: second.id,
            userAnswer: second.options[0] ?? "A",
            correct: false,
            timeSpent: 15,
          },
        ];
  const refreshed = await caller.examDrafts.save({
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 1,
    answers: onReturn,
    modeState: { mode: "real" },
    elapsedSeconds: 200,
    deadlineAt: future,
    token: staleDraft.lastSavedAt,
  });
  check(refreshed.lastSavedAt !== staleDraft.lastSavedAt, "(l) the returning save never moved");

  const settled = await settleReadRealRun(userId, staleDraft);
  check(
    !settled.settled && settled.sessionId === null,
    "a STALE settlement force-submitted a prova real the student came back to",
  );
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore,
    "the stale settlement recorded a session for a run still being taken",
  );
  check(
    (await countRows(db, userAnswers, userId)) === answersBefore,
    "the stale settlement wrote user_answers for a live run",
  );

  const survivor = await caller.examDrafts.get({ mode: "real" });
  check(survivor !== null, "the stale settlement DELETED the run the student came back to");
  check(
    survivor?.answers.length === onReturn.length,
    "the answers added on return did not survive the stale settlement",
  );
  check(
    survivor?.lastSavedAt === refreshed.lastSavedAt,
    "the stale settlement moved the live run's token",
  );

  await assertSilentAgainStillSettles(db, userId, {
    silent,
    sessionsBefore,
    answersBefore,
    answers: onReturn.length,
  });
  console.warn("[smoke] (l) stale settlement → run untouched · silent again → settles OK");
}

/** The tail of (l): the token refuses a MOVED row, not the run. Let the same
 *  prova real go silent again and a fresh settlement records it normally. */
async function assertSilentAgainStillSettles(
  db: SmokeDb,
  userId: string,
  ctx: { silent: string; sessionsBefore: number; answersBefore: number; answers: number },
): Promise<void> {
  await db
    .update(examDrafts)
    .set({ lastSavedAt: ctx.silent })
    .where(and(eq(examDrafts.userId, userId), eq(examDrafts.mode, "real")));

  const late = await settleRealRun(userId);
  check(late.settled && late.sessionId !== null, "(l) a genuinely abandoned run stopped settling");
  check(
    (await countRows(db, studySessions, userId)) === ctx.sessionsBefore + 1,
    "(l) the follow-up settlement did not create exactly one session",
  );
  check(
    (await countRows(db, userAnswers, userId)) === ctx.answersBefore + ctx.answers,
    "(l) the follow-up settlement lost the answers the student added on return",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "(l) the settled draft row survived");
}
