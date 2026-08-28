// scripts/smoke-exam-drafts-s2c.ts
//
// (q), (r) and (s) of the `exam_drafts` smoke block — the DATA PATH slice S2c
// (epic #67, #78) changed. Its own file because the earlier three sit at the
// max-lines cap; the plumbing they share lives in `scripts/lib/smoke-drafts.ts`.
//
//   (q) `questions.byIds` now LEFT JOINs `user_question_states` so the Revisão
//       Espaçada can resume WITHOUT `reviewQueue`. The dangerous half is WHERE
//       the user predicate sits: in the WHERE clause the join silently becomes
//       an INNER one and every question the student never saw disappears —
//       which empties "Questões Salvas" and breaks the standard resume. So this
//       asserts three things at once: the SM-2 columns come back for the
//       student's OWN rows, they are null for a question nobody answered, and
//       the ROW COUNT is unchanged by the join (the proof the predicate is in
//       the ON). Plus the scoping half: another student's state never leaks.
//
//   (r) `examDrafts.list` reports `draftTotalOf`, not `questionIds.length`. For
//       the adaptive mode those differ by construction — `questionIds` is the
//       questions SERVED so far — and the card used to offer "Continuar (3/4)"
//       for a simulado of 10.
//
//   (s) `sessions.record` consuming a SPACED draft: one session, and the draft
//       row is gone in the same transaction (criterion 6 — a run recorded
//       without its claim would come back as "Continuar" forever).

import { eq, notInArray, sql } from "drizzle-orm";
import { appRouter } from "../api/trpc/router";
import { examDrafts, oabQuestions, studySessions, users } from "../drizzle/schema";
import {
  check,
  countRows,
  type SmokeCaller,
  type SmokeDb,
  type SmokeQuestion,
} from "./lib/smoke-drafts";

const OTHER_EXTERNAL_ID = "smoke-test-user-c";

/** A catalog question this smoke user has never answered (no SM-2 row). */
async function unseenQuestionId(db: SmokeDb, seen: string[]): Promise<string> {
  const [row] = await db
    .select({ id: oabQuestions.id })
    .from(oabQuestions)
    .where(notInArray(oabQuestions.id, seen))
    .limit(1);
  if (row === undefined) throw new Error("[smoke] catalog has no question outside the sample");
  return row.id;
}

/** (q) byIds: own SM-2 state, nulls for the unseen, same row count, own user only. */
export async function assertByIdsCarriesOwnSm2State(
  db: SmokeDb,
  caller: SmokeCaller,
  questions: SmokeQuestion[],
): Promise<void> {
  const [answered] = questions;
  if (answered === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const seenIds = questions.map((q) => q.id);
  const unseenId = await unseenQuestionId(db, seenIds);
  const ids = [...seenIds, unseenId];

  const rows = await caller.questions.byIds({ ids });
  check(
    rows.length === ids.length,
    `byIds returned ${String(rows.length)} rows for ${String(ids.length)} ids — the LEFT JOIN ` +
      "is dropping or duplicating questions (user predicate in the WHERE, not the ON?)",
  );

  const answeredRow = rows.find((r) => r.id === answered.id);
  check(answeredRow?.interval !== null, "byIds did not return the student's own SM-2 interval");
  check(
    answeredRow?.repetitions !== null && answeredRow?.nextReviewAt !== null,
    "byIds did not return the student's own SM-2 repetitions/nextReviewAt",
  );

  const unseenRow = rows.find((r) => r.id === unseenId);
  check(unseenRow !== undefined, "byIds dropped a question the student has never seen");
  check(
    unseenRow?.interval === null && unseenRow.repetitions === null,
    "byIds invented an SM-2 state for a question the student never answered",
  );

  // The scoping half: another student's rows are not this student's.
  const [other] = await db
    .insert(users)
    .values({ externalId: OTHER_EXTERNAL_ID, email: "smoke-c@lexflow.test", name: "Smoke C" })
    .onConflictDoUpdate({ target: users.externalId, set: { name: "Smoke C" } })
    .returning({ id: users.id });
  if (other === undefined) throw new Error("[smoke] third smoke user upsert failed");
  try {
    const callerC = appRouter.createCaller({
      externalUserId: OTHER_EXTERNAL_ID,
      userId: other.id,
      role: "user",
    });
    const seenByC = await callerC.questions.byIds({ ids: [answered.id] });
    check(seenByC.length === 1, "byIds hid a global catalog question from another student");
    check(
      seenByC[0]?.interval === null && seenByC[0].repetitions === null,
      "byIds leaked one student's SM-2 state to another (predicate is not on ctx.userId)",
    );
  } finally {
    await db.delete(users).where(eq(users.id, other.id));
  }
  console.warn("[smoke] (q) byIds: own SM-2 state · nulls for unseen · row count intact OK");
}

/** (r) list's "N" is the adaptive TARGET, never the number of questions served. */
export async function assertAdaptiveTotalIsTheTarget(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  // Three questions SERVED (one of them twice — a postponed one that came back)
  // out of a simulado of 10.
  const served = [first.id, questions[1]?.id ?? first.id, first.id];

  await caller.examDrafts.save({
    mode: "adaptive",
    setup: { mode: "adaptive", discipline: first.discipline, totalQuestions: 10 },
    questionIds: served,
    cursor: 2,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 15 },
    ],
    modeState: {
      mode: "adaptive",
      adaptive: {
        currentDifficulty: "hard",
        consecutiveCorrect: 2,
        consecutiveWrong: 0,
        totalCorrect: 1,
        totalAnswered: 1,
        difficultyHistory: ["medium", "hard"],
      },
      totalQuestions: 10,
      deferredIds: [first.id],
    },
    elapsedSeconds: 90,
    token: null,
  });

  const listed = await caller.examDrafts.list();
  const adaptive = listed.find((r) => r.mode === "adaptive");
  check(adaptive !== undefined, "list did not return the adaptive draft");
  check(
    adaptive?.total === 10,
    `list reported total ${String(adaptive?.total)} — the adaptive N must be the TARGET (10), ` +
      "not the number of questions served",
  );
  check(adaptive?.answered === 1, "list did not report 1 answered question");

  // The ladder and the FIFO survive the jsonb round-trip verbatim.
  const draft = await caller.examDrafts.get({ mode: "adaptive" });
  check(draft?.modeState.mode === "adaptive", "get returned a non-adaptive mode_state");
  if (draft?.modeState.mode === "adaptive") {
    check(
      draft.modeState.adaptive.currentDifficulty === "hard" &&
        draft.modeState.adaptive.consecutiveCorrect === 2,
      "the adaptive ladder did not survive the jsonb round-trip",
    );
    check(
      JSON.stringify(draft.modeState.deferredIds) === JSON.stringify([first.id]),
      "the deferred FIFO did not survive the jsonb round-trip",
    );
  }
  check(
    JSON.stringify(draft?.questionIds) === JSON.stringify(served),
    "the SERVED list lost its duplicate — the cursor is a position in it",
  );

  await caller.examDrafts.discard({ mode: "adaptive" });
  check((await countRows(db, examDrafts, userId)) === 0, "discard left the adaptive draft behind");
  console.warn("[smoke] (r) adaptive list total = modeState.totalQuestions (not served) OK");
}

/** (s) a SPACED run recorded with its claim: 1 session, 0 drafts left. */
export async function assertSpacedRecordConsumesDraft(
  db: SmokeDb,
  caller: SmokeCaller,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");
  const sessionsBefore = await countRows(db, studySessions, userId);

  await caller.examDrafts.save({
    mode: "spaced",
    setup: { mode: "spaced" },
    questionIds: questions.map((q) => q.id),
    cursor: 1,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 11 },
    ],
    modeState: { mode: "spaced" },
    elapsedSeconds: 0,
    token: null,
  });

  const saved = await caller.examDrafts.get({ mode: "spaced" });
  check(saved !== null, "the spaced draft vanished right after being saved");
  if (saved === null) throw new Error("unreachable");
  check(saved.elapsedSeconds === 0, "the spaced run persisted a run clock it does not have");

  const rec = await caller.sessions.record({
    discipline: first.discipline,
    difficulty: "medium",
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 11 },
    ],
    draft: { id: saved.id, lastSavedAt: saved.lastSavedAt },
  });
  check(rec.sessionId.length > 0, "recording a spaced run with its claim returned no session");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "recording a spaced run did not create exactly one session",
  );
  check(
    (await countRows(db, examDrafts, userId)) === 0,
    "the spaced draft survived its own recording — it would come back as 'Continuar'",
  );

  // …and the SM-2 schedule moved exactly once, through `sessions.record` only.
  const states = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM user_question_states WHERE user_id = ${userId}`,
  );
  check((states.rows[0]?.n ?? 0) > 0, "a processed review left the SM-2 schedule untouched");
  console.warn("[smoke] (s) sessions.record(spaced draft) → 1 session, 0 drafts left OK");
}
