// scripts/smoke-exam-drafts-stale.ts
//
// (l), (m) and (n) of the `exam_drafts` smoke block (epic #67 S2a, review of
// PR #80): the STALE-READ window on the WRITE path. A caller reads a run, judges
// it, and only then claims it — and in between, the run can move. Claiming
// unconditionally at that point force-submits a LIVE run with older answers and
// destroys what happened in between. `last_saved_at` is carried into every claim
// as the optimistic token (the same one `save`/`touch` use), so a moved row
// matches 0 rows and the claim is refused, exactly like losing the race. Its own
// file because `smoke-exam-drafts.ts` sits at the max-lines cap; the plumbing
// they share lives in `scripts/lib/smoke-drafts.ts`.
//
// THREE claims carry that token, so all three need their own assertion — they
// are independent code and one passing proves nothing about the others:
//   (l) ≥1 answer, SERVER  → the claim is the draft delete inside `recordSession`
//                            (settle-real-run.ts, lazy settlement).
//   (m) 0 answers, SERVER  → the claim is the bare delete in `settleReadRealRun`.
//   (n) CLIENT submit      → the same delete inside `recordSession`, reached from
//                            `sessions.record` with the token the TAB observed.
// (m) is the branch where the damage is worst: nothing is recorded, so a wrong
// delete leaves the student's run simply GONE, with no session to show for it.
// (n) is the one the review caught: the id de-duplicates, it does not detect
// staleness, and two tabs of the SAME student are exactly the failure case.

import { and, eq } from "drizzle-orm";
import { settleReadRealRun, settleRealRun } from "../api/lib/settle-real-run";
import { examDrafts, studySessions, userAnswers } from "../drizzle/schema";
import {
  check,
  countRows,
  raises,
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

/** (m) The SAME stale-read window, on the ZERO-ANSWER branch: a prova real the
 *  student opened but has not answered yet. That branch does not record anything
 *  — it just deletes the row — so an unguarded claim does not force-submit the
 *  run, it ERASES it: the student comes back to an exam that no longer exists
 *  and never became a session. The delete carries the same `last_saved_at`
 *  token, and a `touch` (the 60 s heartbeat — the only thing an unanswered run
 *  even sends) landing in the window must make the claim match 0 rows. The tail
 *  proves the refusal is the token and not a lockout, exactly as in (l). */
export async function assertStaleZeroAnswerSettlementNeverDeletes(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const sessionsBefore = await countRows(db, studySessions, userId);
  const answersBefore = await countRows(db, userAnswers, userId);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const silent = new Date(Date.now() - 300_000).toISOString(); // 5 min: 3 beats missed

  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [], // opened, still reading the first question
    modeState: { mode: "real" },
    elapsedSeconds: 45,
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
  if (staleDraft === undefined) throw new Error("[smoke] (m) the prova real insert did not land");
  check(staleDraft.answers.length === 0, "(m) the fixture is not the zero-answer branch");

  // The tab was alive all along: its heartbeat lands, moving `last_saved_at`.
  const refreshed = await caller.examDrafts.touch({
    mode: "real",
    token: staleDraft.lastSavedAt,
  });
  check(refreshed.lastSavedAt !== staleDraft.lastSavedAt, "(m) the returning touch never moved");

  const settled = await settleReadRealRun(userId, staleDraft);
  check(
    !settled.settled && settled.sessionId === null,
    "(m) a STALE settlement claimed an unanswered prova real the student came back to",
  );
  const survivor = await caller.examDrafts.get({ mode: "real" });
  check(survivor !== null, "(m) the stale settlement DELETED an unanswered run still in progress");
  check(
    survivor?.lastSavedAt === refreshed.lastSavedAt,
    "(m) the stale settlement moved the live run's token",
  );
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore,
    "(m) the stale settlement invented a session for an unanswered run",
  );

  await assertUnansweredSilentAgainStillSettles(db, userId, { silent, sessionsBefore });
  check(
    (await countRows(db, userAnswers, userId)) === answersBefore,
    "(m) an unanswered prova real wrote user_answers",
  );
  console.warn("[smoke] (m) stale 0-answer settlement → run untouched · silent again → deletes OK");
}

/** The tail of (m): let the same unanswered run go genuinely silent and the
 *  claim lands — row deleted, and still NO session, because an untouched exam is
 *  not a result. Without this, (m) could pass on a settlement that never claims
 *  anything at all. */
async function assertUnansweredSilentAgainStillSettles(
  db: SmokeDb,
  userId: string,
  ctx: { silent: string; sessionsBefore: number },
): Promise<void> {
  await db
    .update(examDrafts)
    .set({ lastSavedAt: ctx.silent })
    .where(and(eq(examDrafts.userId, userId), eq(examDrafts.mode, "real")));

  const late = await settleRealRun(userId);
  check(
    late.settled && late.sessionId === null,
    "(m) a genuinely abandoned unanswered run stopped settling",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "(m) the settled draft row survived");
  check(
    (await countRows(db, studySessions, userId)) === ctx.sessionsBefore,
    "(m) settling an unanswered run created a session",
  );
}

/** (n) The SAME stale-read window on the CLIENT SUBMIT path — the hole review
 *  #80 caught. Tab A holds a run and the token it observed; tab B (the same
 *  student, another tab/device) continues that run and saves, moving
 *  `last_saved_at`; tab A then finishes and calls `sessions.record` for that
 *  draft id. Claiming by id + user alone de-duplicates but does NOT detect
 *  staleness: A would delete B's fresher row and record A's older answers, and
 *  everything B did in between would be gone with no trace. The claim carries
 *  the token A observed, so it matches 0 rows ⇒ CONFLICT, with the draft and B's
 *  answers intact. The tail proves the refusal is the TOKEN, not a lockout: tab
 *  B submits with the CURRENT token and records normally. */
export async function assertStaleClientSubmitNeverClaims(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first, second] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  const sessionsBefore = await countRows(db, studySessions, userId);
  const answersBefore = await countRows(db, userAnswers, userId);

  const answeredByA = [
    { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 20 },
  ];
  const base = {
    mode: "standard" as const,
    setup: {
      mode: "standard" as const,
      discipline: first.discipline,
      examBoard: null,
      difficulty: null,
    },
    questionIds: questions.map((q) => q.id),
    modeState: { mode: "standard" as const, carriedTime: {} },
  };

  // Tab A: the run as A knows it. `tokenA` is what A would send on submit.
  const savedByA = await caller.examDrafts.save({
    ...base,
    cursor: 1,
    answers: answeredByA,
    elapsedSeconds: 40,
    token: null,
  });
  const draft = await caller.examDrafts.get({ mode: "standard" });
  if (draft === null) throw new Error("[smoke] (n) the standard draft insert did not land");
  const tokenA = savedByA.lastSavedAt;

  // Tab B continues the SAME run and saves — the token moves under tab A.
  const answeredByB =
    second === undefined
      ? answeredByA
      : [
          ...answeredByA,
          {
            questionId: second.id,
            userAnswer: second.options[0] ?? "A",
            correct: false,
            timeSpent: 25,
          },
        ];
  const savedByB = await caller.examDrafts.save({
    ...base,
    cursor: 2,
    answers: answeredByB,
    elapsedSeconds: 90,
    token: tokenA,
  });
  check(savedByB.lastSavedAt !== tokenA, "(n) the second tab's save never moved the token");

  // Tab A finishes and submits the run AS IT REMEMBERS IT.
  const refused = await raises("CONFLICT", () =>
    caller.sessions.record({
      discipline: first.discipline,
      difficulty: "medium",
      answers: answeredByA,
      draft: { id: draft.id, lastSavedAt: tokenA },
    }),
  );
  check(refused, "a STALE tab recorded a draft another tab had already moved");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore,
    "(n) the refused stale submit still created a session",
  );
  check(
    (await countRows(db, userAnswers, userId)) === answersBefore,
    "(n) the refused stale submit still wrote user_answers",
  );

  const survivor = await caller.examDrafts.get({ mode: "standard" });
  check(survivor !== null, "(n) the stale submit DELETED the run the other tab was taking");
  check(
    survivor?.answers.length === answeredByB.length,
    "(n) the answers the other tab added did not survive the stale submit",
  );
  check(survivor?.lastSavedAt === savedByB.lastSavedAt, "(n) the stale submit moved the token");

  await assertCurrentTokenStillRecords(db, caller, userId, {
    id: draft.id,
    token: savedByB.lastSavedAt,
    discipline: first.discipline,
    answers: answeredByB,
    sessionsBefore,
    answersBefore,
  });
  console.warn("[smoke] (n) stale tab submit → CONFLICT, run intact · current token → records OK");
}

/** The tail of (n): the token refuses a MOVED row, not the run. The tab holding
 *  the CURRENT token submits the same draft and it records normally — one
 *  session, its answers, and the draft consumed. Without this, (n) could pass on
 *  a `sessions.record` that refuses every draft-backed submit there is. */
async function assertCurrentTokenStillRecords(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  ctx: {
    id: string;
    token: string;
    discipline: string;
    answers: { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[];
    sessionsBefore: number;
    answersBefore: number;
  },
): Promise<void> {
  const rec = await caller.sessions.record({
    discipline: ctx.discipline,
    difficulty: "medium",
    answers: ctx.answers,
    draft: { id: ctx.id, lastSavedAt: ctx.token },
  });
  check(rec.sessionId.length > 0, "(n) the tab holding the current token could not record");
  check(
    (await countRows(db, studySessions, userId)) === ctx.sessionsBefore + 1,
    "(n) the fresh submit did not create exactly one session",
  );
  check(
    (await countRows(db, userAnswers, userId)) === ctx.answersBefore + ctx.answers.length,
    "(n) the fresh submit lost the answers the other tab added",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "(n) the recorded draft row survived");
}
