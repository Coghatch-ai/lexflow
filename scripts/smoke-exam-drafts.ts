// scripts/smoke-exam-drafts.ts
//
// The `exam_drafts` half of `pnpm smoke` (epic #67 S2a). Kept out of smoke.ts so
// main() stays inside max-lines-per-function.
//
// This is the ONLY place the design can actually be proven: per-user scoping,
// the optimistic token, the single-transaction hand-off between sessions.record
// and the in-flight row, and the FK-safe server-side settlement all need a real
// database. The load-bearing ones are (b): a SECOND throwaway user, proving the
// TABLE_SCOPE entry — without it `conditions()` returns sql`true` and one
// student's unfinished draft is served to another — and (j): two CONCURRENT
// settlements of the same abandoned prova real, which is the only way to prove
// the draft delete really is the mutex that keeps one run to one session — plus
// (k), which proves `discard` cannot be used as a back door to destroy a prova
// real whose answers still owe a session, and (l)+(m)+(n), which prove a caller
// holding a STALE read cannot claim a run that moved under it — (l) on the
// settlement branch that records a session, (m) on the zero-answer branch that
// only deletes (where a wrong claim erases the run without leaving any trace at
// all), and (n) on the CLIENT submit path, where the two racers are two tabs of
// the SAME student and the draft id alone de-duplicates without detecting
// staleness — plus (o) and (p) (scripts/smoke-exam-drafts-mode.ts), which cover
// what no token assertion does: (o) that a client submitting the prova real
// through `sessions.record` can never file it as a study session (BR-05.5), and
// (p) that `deadlineAt` survives the save → get → save echo a resumed screen
// makes with the API's own raw-PG value.

import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../api/trpc/router";
import { settleRealRun } from "../api/lib/settle-real-run";
import { examDrafts, studySessions, userAnswers, users } from "../drizzle/schema";
import {
  assertStaleClientSubmitNeverClaims,
  assertStaleSettlementNeverForceSubmits,
  assertStaleZeroAnswerSettlementNeverDeletes,
} from "./smoke-exam-drafts-stale";
import {
  assertClientCannotFileRealAsStudy,
  assertClientProcessRealRecordsOnce,
  assertDeadlineRoundTrips,
  assertHeartbeatRotatesTheToken,
} from "./smoke-exam-drafts-mode";
import {
  assertAdaptiveTotalIsTheTarget,
  assertByIdsCarriesOwnSm2State,
  assertSpacedRecordConsumesDraft,
} from "./smoke-exam-drafts-s2c";
import {
  check,
  countRows,
  raises,
  type SmokeCaller,
  type SmokeDb,
  type SmokeQuestion,
} from "./lib/smoke-drafts";

const OTHER_EXTERNAL_ID = "smoke-test-user-b";

/** (a) save creates the draft and get returns it, queue order intact. */
async function assertSaveAndGet(
  caller: SmokeCaller,
  questions: SmokeQuestion[],
): Promise<{ token: string; draftId: string }> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const questionIds = questions.map((q) => q.id);

  const saved = await caller.examDrafts.save({
    mode: "standard",
    setup: { mode: "standard", discipline: first.discipline, examBoard: null, difficulty: null },
    questionIds,
    cursor: 1,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 12 },
    ],
    modeState: { mode: "standard", carriedTime: { [first.id]: 12 } },
    elapsedSeconds: 42,
    token: null,
  });

  const draft = await caller.examDrafts.get({ mode: "standard" });
  check(draft !== null, "get returned null right after save");
  if (draft === null) throw new Error("unreachable");
  check(
    JSON.stringify(draft.questionIds) === JSON.stringify(questionIds),
    "get did not return the frozen queue order",
  );
  check(draft.cursor === 1, `get returned cursor ${String(draft.cursor)}, expected 1`);

  const listed = await caller.examDrafts.list();
  const standard = listed.find((r) => r.mode === "standard");
  check(standard?.answered === 1, "list did not report 1 answered question");
  check(standard?.total === questionIds.length, "list did not report the full queue length");
  console.warn("[smoke] (a) examDrafts.save + get + list (n/N) OK");
  return { token: saved.lastSavedAt, draftId: draft.id };
}

/** (b) THE scoping proof: user A never sees user B's draft, and vice versa. */
async function assertScopedToOwner(
  db: SmokeDb,
  callerA: SmokeCaller,
  questions: SmokeQuestion[],
): Promise<void> {
  const [other] = await db
    .insert(users)
    .values({ externalId: OTHER_EXTERNAL_ID, email: "smoke-b@lexflow.test", name: "Smoke B" })
    .onConflictDoUpdate({ target: users.externalId, set: { name: "Smoke B" } })
    .returning({ id: users.id });
  if (other === undefined) throw new Error("[smoke] second smoke user upsert failed");

  try {
    const callerB = appRouter.createCaller({
      externalUserId: OTHER_EXTERNAL_ID,
      userId: other.id,
      role: "user",
    });

    await callerB.examDrafts.save({
      mode: "spaced",
      setup: { mode: "spaced" },
      questionIds: questions.map((q) => q.id),
      cursor: 0,
      answers: [],
      modeState: { mode: "spaced" },
      elapsedSeconds: 5,
      token: null,
    });

    const listA = await callerA.examDrafts.list();
    check(
      listA.every((r) => r.mode !== "spaced"),
      "user A can SEE user B's draft — exam_drafts is missing its TABLE_SCOPE entry",
    );
    check(
      (await callerA.examDrafts.get({ mode: "spaced" })) === null,
      "examDrafts.get leaked user B's draft to user A",
    );

    const listB = await callerB.examDrafts.list();
    check(
      listB.every((r) => r.mode !== "standard"),
      "user B can see user A's draft — exam_drafts is missing its TABLE_SCOPE entry",
    );
    console.warn("[smoke] (b) exam_drafts scoping across two users OK (TABLE_SCOPE proven)");
  } finally {
    await db.delete(users).where(eq(users.id, other.id));
  }
}

/** (c) a save carrying a superseded token raises CONFLICT instead of overwriting. */
async function assertStaleTokenConflicts(
  caller: SmokeCaller,
  questions: SmokeQuestion[],
  staleToken: string,
): Promise<void> {
  const base = {
    mode: "standard" as const,
    setup: {
      mode: "standard" as const,
      discipline: "x",
      examBoard: null,
      difficulty: null,
    },
    questionIds: questions.map((q) => q.id),
    cursor: 2,
    answers: [],
    modeState: { mode: "standard" as const, carriedTime: {} },
    elapsedSeconds: 60,
  };

  const fresh = await caller.examDrafts.save({ ...base, token: staleToken });
  check(fresh.lastSavedAt !== staleToken, "save did not advance last_saved_at (token never moves)");

  let conflicted = false;
  try {
    await caller.examDrafts.save({ ...base, token: staleToken });
  } catch (err: unknown) {
    conflicted = err instanceof TRPCError && err.code === "CONFLICT";
    if (!conflicted) throw err;
  }
  check(conflicted, "a stale token silently overwrote the other device's progress");
  console.warn("[smoke] (c) stale token → CONFLICT OK");
}

/** (g) BR-05.8 — a `token: null` save NEVER bulldozes a live run of the same
 *  mode: it raises CONFLICT and the existing draft is left byte-for-byte alone.
 *  Replacing a run is a deliberate act (`discard`, or `startReal` on the real). */
async function assertFirstSaveNeverOverwrites(
  caller: SmokeCaller,
  questions: SmokeQuestion[],
): Promise<void> {
  const before = await caller.examDrafts.get({ mode: "standard" });
  check(before !== null, "(g) needs a live standard draft to protect");
  if (before === null) throw new Error("unreachable");

  const conflicted = await raises("CONFLICT", () =>
    caller.examDrafts.save({
      mode: "standard",
      setup: { mode: "standard", discipline: "x", examBoard: null, difficulty: null },
      questionIds: questions.map((q) => q.id),
      cursor: 0,
      answers: [],
      modeState: { mode: "standard", carriedTime: {} },
      elapsedSeconds: 1,
      token: null, // "first save" — but a run is already in progress
    }),
  );
  check(conflicted, "a token:null save silently overwrote a live draft (BR-05.8)");

  const after = await caller.examDrafts.get({ mode: "standard" });
  check(after?.lastSavedAt === before.lastSavedAt, "the refused save still moved last_saved_at");
  check(after?.cursor === before.cursor, "the refused save still changed the live run");
  console.warn("[smoke] (g) token:null over a live draft → CONFLICT, run intact OK");
}

/** (h) a payload whose three discriminators disagree is refused at the door —
 *  it would persist a run the resume path cannot rehydrate. */
async function assertModeMismatchRejected(
  caller: SmokeCaller,
  questions: SmokeQuestion[],
): Promise<void> {
  const rejected = await raises("BAD_REQUEST", () =>
    caller.examDrafts.save({
      mode: "real",
      setup: { mode: "real" },
      questionIds: questions.map((q) => q.id),
      cursor: 0,
      answers: [],
      modeState: { mode: "standard", carriedTime: {} }, // ← disagrees with mode
      elapsedSeconds: 1,
      token: null,
    }),
  );
  check(rejected, "a save with mode ≠ modeState.mode was accepted");
  console.warn("[smoke] (h) mode ≠ setup.mode ≠ modeState.mode → BAD_REQUEST OK");
}

/** (i) BR-05.5 — a LIVE prova real is never offered back by `list`, and listing
 *  does not destroy it either (the tab that owns it is still running). */
async function assertRealNeverListed(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [],
    modeState: { mode: "real" },
    elapsedSeconds: 10,
    deadlineAt: future, // fresh: hours of exam left, heartbeat just now
    createdBy: userId,
    lastUpdBy: userId,
  });

  const listed = await caller.examDrafts.list();
  check(
    listed.every((r) => r.mode !== "real"),
    "list offered a prova real back to continue (BR-05.5)",
  );
  check(
    (await countRows(db, examDrafts, userId)) > 0,
    "listing settled a prova real that was still being taken",
  );

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (i) list never returns a live prova real OK");
}

/** (k) BR-05.5 through the OTHER door: `discard` refuses a prova real. Dropping
 *  it would throw away answers that still have to become a session — the real
 *  exam ends only through settlement (`startReal` / `processReal`). A study mode
 *  stays discardable, which is what makes this a narrowing and not a lockout. */
async function assertRealCannotBeDiscarded(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const future = new Date(Date.now() + 3_600_000).toISOString();

  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 30 },
    ],
    modeState: { mode: "real" },
    elapsedSeconds: 120,
    deadlineAt: future, // still being taken: hours left on the clock
    createdBy: userId,
    lastUpdBy: userId,
  });
  await caller.examDrafts.save({
    mode: "standard",
    setup: { mode: "standard", discipline: first.discipline, examBoard: null, difficulty: null },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [],
    modeState: { mode: "standard", carriedTime: {} },
    elapsedSeconds: 7,
    token: null,
  });

  const refused = await raises("BAD_REQUEST", () => caller.examDrafts.discard({ mode: "real" }));
  check(refused, "examDrafts.discard accepted mode 'real' (BR-05.5 hole)");
  check(
    (await countRows(db, examDrafts, userId)) === 2,
    "the refused discard still deleted a draft row",
  );

  await caller.examDrafts.discard({ mode: "standard" });
  check(
    (await countRows(db, examDrafts, userId)) === 1,
    "discard on a study mode did not drop exactly that draft",
  );
  check(
    (await caller.examDrafts.get({ mode: "real" })) !== null,
    "discarding the standard run also destroyed the prova real",
  );

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (k) discard: 'real' → BAD_REQUEST, study mode → dropped OK");
}

/** (j) THE race: two settlements of the SAME abandoned prova real, in flight at
 *  once (users.me + examDrafts.list on one render, two tabs, or the client's
 *  processReal against the server). Exactly ONE session, ONE answer row, and
 *  exactly one caller may claim it — the draft delete is the mutex (BR-05.7). */
async function assertConcurrentSettlementRecordsOnce(
  db: SmokeDb,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const past = new Date(Date.now() - 60_000).toISOString();

  const sessionsBefore = await countRows(db, studySessions, userId);
  const answersBefore = await countRows(db, userAnswers, userId);

  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 30 },
    ],
    modeState: { mode: "real" },
    elapsedSeconds: 120,
    deadlineAt: past,
    createdBy: userId,
    lastUpdBy: userId,
  });

  const [a, b] = await Promise.all([settleRealRun(userId), settleRealRun(userId)]);
  const winners = [a, b].filter((r) => r.sessionId !== null);
  check(
    winners.length === 1,
    `${String(winners.length)} concurrent settlements recorded a session`,
  );
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "a concurrent double settlement created MORE THAN ONE session (BR-05.7 broken)",
  );
  check(
    (await countRows(db, userAnswers, userId)) === answersBefore + 1,
    "a concurrent double settlement duplicated user_answers (SM-2 advanced twice)",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "the settled draft row survived the race");
  console.warn("[smoke] (j) two concurrent settlements → exactly ONE session OK");
}

/** (d) sessions.record with a draft claim records the session AND consumes the
 *  draft. The claim is `{ id, lastSavedAt }` — the token the owning tab last
 *  observed travels WITH the id, always; (n) proves what that refuses. */
async function assertRecordConsumesDraft(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
  draftId: string,
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");

  // The token as the tab that owns this run holds it: its latest save/get.
  const live = await caller.examDrafts.get({ mode: "standard" });
  check(live?.id === draftId, "(d) the live standard draft is not the run (a) created");
  if (live === null) throw new Error("unreachable");
  const draft = { id: draftId, lastSavedAt: live.lastSavedAt };

  const rec = await caller.sessions.record({
    discipline: first.discipline,
    difficulty: "medium",
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 20 },
    ],
    draft,
  });
  check(rec.sessionId.length > 0, "sessions.record with a draft claim returned no session");
  check(
    (await countRows(db, examDrafts, userId)) === 0,
    "the in-flight draft survived the recording transaction",
  );

  // Replaying the SAME claim (the client's timer firing after the server
  // already settled the run) must write nothing at all — CONFLICT, not a
  // second session with a second set of answers.
  const sessionsAfterFirst = await countRows(db, studySessions, userId);
  const answersAfterFirst = await countRows(db, userAnswers, userId);
  const replayed = await raises("CONFLICT", () =>
    caller.sessions.record({
      discipline: first.discipline,
      difficulty: "medium",
      answers: [
        { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 20 },
      ],
      draft,
    }),
  );
  check(replayed, "recording an ALREADY consumed draft was accepted a second time");
  check(
    (await countRows(db, studySessions, userId)) === sessionsAfterFirst,
    "the refused replay still created a session",
  );
  check(
    (await countRows(db, userAnswers, userId)) === answersAfterFirst,
    "the refused replay still wrote user_answers (rollback did not happen)",
  );
  console.warn("[smoke] (d) sessions.record(draft) → 1 session, replay → CONFLICT + rollback OK");
}

/** (e) an abandoned prova real is settled server-side: ≥1 answer records ONE
 *  session; 0 answers records nothing. Both delete the row. */
async function assertSettlesAbandonedReal(
  db: SmokeDb,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const past = new Date(Date.now() - 60_000).toISOString();

  const sessionsBefore = await countRows(db, studySessions, userId);
  const answersBefore = await countRows(db, userAnswers, userId);

  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 30 },
    ],
    modeState: { mode: "real" },
    elapsedSeconds: 120,
    deadlineAt: past,
    createdBy: userId,
    lastUpdBy: userId,
  });

  const settled = await settleRealRun(userId);
  check(settled.settled && settled.sessionId !== null, "an expired prova real was not settled");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "settlement did not create exactly one session",
  );
  check(
    (await countRows(db, userAnswers, userId)) === answersBefore + 1,
    "settlement did not record exactly the answered question",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "settlement left the draft row behind");

  // 0 answers: the row goes, no session is invented.
  await db.insert(examDrafts).values({
    userId,
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    cursor: 0,
    answers: [],
    modeState: { mode: "real" },
    elapsedSeconds: 30,
    deadlineAt: past,
    createdBy: userId,
    lastUpdBy: userId,
  });
  const empty = await settleRealRun(userId);
  check(empty.settled && empty.sessionId === null, "an untouched prova real created a session");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "an untouched prova real changed the session count",
  );
  check((await countRows(db, examDrafts, userId)) === 0, "the untouched draft row survived");
  console.warn("[smoke] (e) settleRealRun: 1 answer → 1 session · 0 answers → no session OK");
}

/**
 * Runs every `exam_drafts` assertion. (f) — an UNPROCESSED draft never reaches
 * statistics or SM-2 — brackets the whole block: nothing in the stats router or
 * in reviewQueue reads `exam_drafts`, and this proves it stays that way.
 */
export async function smokeExamDrafts(opts: {
  db: SmokeDb;
  caller: SmokeCaller;
  userId: string;
  questions: SmokeQuestion[];
}): Promise<void> {
  const { db, caller, userId, questions } = opts;

  const summaryBefore = JSON.stringify(await caller.stats.summary());
  const sm2Before = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM user_question_states WHERE user_id = ${userId}`,
  );

  const { token, draftId } = await assertSaveAndGet(caller, questions);

  const summaryAfter = JSON.stringify(await caller.stats.summary());
  const sm2After = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM user_question_states WHERE user_id = ${userId}`,
  );
  check(summaryAfter === summaryBefore, "an in-flight draft changed stats.summary");
  check(
    sm2Before.rows[0]?.n === sm2After.rows[0]?.n,
    "an in-flight draft touched the SM-2 schedule",
  );
  console.warn("[smoke] (f) in-flight draft leaves stats.summary + SM-2 untouched OK");

  await assertScopedToOwner(db, caller, questions);
  await assertStaleTokenConflicts(caller, questions, token);
  await assertFirstSaveNeverOverwrites(caller, questions);
  await assertModeMismatchRejected(caller, questions);
  await assertRecordConsumesDraft(db, caller, userId, questions, draftId);
  await assertRealNeverListed(db, caller, userId, questions);
  await assertRealCannotBeDiscarded(db, caller, userId, questions);
  await assertSettlesAbandonedReal(db, userId, questions);
  await assertConcurrentSettlementRecordsOnce(db, userId, questions);
  await assertStaleSettlementNeverForceSubmits(db, caller, userId, questions);
  await assertStaleZeroAnswerSettlementNeverDeletes(db, caller, userId, questions);
  await assertStaleClientSubmitNeverClaims(db, caller, userId, questions);
  await assertClientCannotFileRealAsStudy(db, caller, userId, questions);
  await assertDeadlineRoundTrips(caller, db, userId, questions);

  // (t)–(u): the data path slice S2d adds — the 60 s heartbeat's token and the
  // client's own auto-submit when the 5 h deadline passes.
  await assertHeartbeatRotatesTheToken(caller, db, userId, questions);
  await assertClientProcessRealRecordsOnce(caller, db, userId, questions);

  // (q)–(s): the data path slice S2c changed — `byIds` + the "N" of the card +
  // the spaced run's own claim. They run last because each needs a clean
  // `exam_drafts` for this user, which the sweep below guarantees for the next.
  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  await assertByIdsCarriesOwnSm2State(db, caller, questions);
  await assertAdaptiveTotalIsTheTarget(db, caller, userId, questions);
  await assertSpacedRecordConsumesDraft(db, caller, userId, questions);

  // Belt and braces: nothing this block created may outlive it.
  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] ✓ exam_drafts (a)–(u) OK");
}
