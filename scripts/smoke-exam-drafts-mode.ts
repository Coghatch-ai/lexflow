// scripts/smoke-exam-drafts-mode.ts
//
// (o) and (p) of the `exam_drafts` smoke block (epic #67 S2a, adversarial review
// of 9242987). Both prove things about `mode` and about the CONTRACT of the
// columns a client echoes back — the two holes (a)–(n) walked straight past.
// Its own file because `smoke-exam-drafts.ts` and `-stale.ts` both sit at the
// max-lines cap; the plumbing they share lives in `scripts/lib/smoke-drafts.ts`.
//
//   (o) BR-05.5, the CLIENT door: `examDrafts.get({ mode: "real" })` hands the
//       browser the prova real's id AND its `last_saved_at` token, so a client
//       can submit a real run through `sessions.record` — the study-mode path —
//       with a discipline of its own choosing. Same run, two different session
//       rows depending on who wins the race, which is exactly what BR-05.5
//       forbids. The claimed row's `mode` now decides the filing, so the run is
//       "Prova Real"/hard whichever door it left by.
//
//   (p) `deadlineAt` must accept the API's OWN output. drizzle overrides the
//       TIMESTAMPTZ parser to identity, so `get` returns raw PG text
//       ("2026-08-21 14:30:04.210932+00"), which `z.string().datetime()`
//       refuses — a rehydrating screen that echoed what it read got BAD_REQUEST,
//       and one that dropped the field silently erased the deadline the
//       auto-submit depends on. No fixture caught it because every `real` row in
//       this suite is planted with `db.insert`; this one goes through `save`.

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { studySessions, examDrafts } from "../drizzle/schema";
import { REAL_EXAM_DIFFICULTY, REAL_EXAM_DISCIPLINE } from "../shared/domain/exam-draft";
import {
  check,
  countRows,
  raises,
  type SmokeCaller,
  type SmokeDb,
  type SmokeQuestion,
} from "./lib/smoke-drafts";

/** A discipline the prova real is definitely NOT filed under — what a client
 *  would put in the payload while submitting the real run through the study
 *  path. If it ever reaches `study_sessions`, the invariant is gone. */
const CLIENT_DISCIPLINE = "Direito Civil";

/**
 * (o) A client submitting the LIVE prova real through `sessions.record` never
 * produces a study-shaped session. Either the claim is refused, or the session
 * is filed exactly as the server-side settlement files it — never under the
 * discipline/difficulty the client sent.
 */
export async function assertClientCannotFileRealAsStudy(
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
    deadlineAt: future, // fresh: the exam is still being taken
    createdBy: userId,
    lastUpdBy: userId,
  });

  // Everything the attack needs, and the client is HANDED both by the API.
  const real = await caller.examDrafts.get({ mode: "real" });
  check(real !== null, "(o) examDrafts.get did not return the planted prova real");
  if (real === null) throw new Error("unreachable");

  const sessionsBefore = await countRows(db, studySessions, userId);
  let sessionId: string | null = null;
  try {
    const rec = await caller.sessions.record({
      discipline: CLIENT_DISCIPLINE, // ← the client's own label for a REAL run
      difficulty: "medium",
      answers: [
        { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 20 },
      ],
      draft: { id: real.id, lastSavedAt: real.lastSavedAt },
    });
    sessionId = rec.sessionId;
  } catch (err: unknown) {
    // Refusing the claim outright is the other acceptable answer — but ONLY as
    // a deliberate refusal. Anything else (a 500 from a malformed query, say)
    // must fail the smoke instead of passing for the wrong reason.
    const refused =
      err instanceof TRPCError && (err.code === "CONFLICT" || err.code === "BAD_REQUEST");
    if (!refused) throw err;
    check(
      (await countRows(db, studySessions, userId)) === sessionsBefore,
      "(o) the refused real claim still wrote a session",
    );
  }

  if (sessionId !== null) {
    const [filed] = await db.select().from(studySessions).where(eq(studySessions.id, sessionId));
    check(filed !== undefined, "(o) sessions.record returned an id with no row behind it");
    check(
      filed?.discipline === REAL_EXAM_DISCIPLINE,
      `(o) a prova real was filed as "${String(filed?.discipline)}" — the CLIENT's discipline reached study_sessions (BR-05.5)`,
    );
    check(
      filed?.difficulty === REAL_EXAM_DIFFICULTY,
      `(o) a prova real was filed as difficulty "${String(filed?.difficulty)}" instead of ${REAL_EXAM_DIFFICULTY}`,
    );
    check(
      (await countRows(db, examDrafts, userId)) === 0,
      "(o) the prova real row survived the client submit",
    );
  }

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (o) client submit of a prova real → never a study-shaped session OK");
}

/**
 * (p) `deadlineAt` survives the round-trip a rehydrating screen actually makes:
 * save an ISO deadline → read the row back (raw PG text) → save AGAIN echoing
 * that exact value. The echo is the step that used to fail: the schema refused
 * the API's own output, so the deadline could only be kept by luck.
 */
export async function assertDeadlineRoundTrips(
  caller: SmokeCaller,
  db: SmokeDb,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const iso = new Date(Date.now() + 5 * 3_600_000).toISOString(); // 5 h of exam left
  const base = {
    mode: "real" as const,
    setup: { mode: "real" as const },
    questionIds: questions.map((q) => q.id),
    answers: [],
    modeState: { mode: "real" as const },
  };

  await caller.examDrafts.save({
    ...base,
    cursor: 0,
    elapsedSeconds: 0,
    deadlineAt: iso,
    token: null,
  });

  const read = await caller.examDrafts.get({ mode: "real" });
  check(read?.deadlineAt != null, "(p) save(deadlineAt) did not persist the deadline");
  const stored = read?.deadlineAt ?? "";
  check(
    Date.parse(stored) === Date.parse(iso),
    `(p) the stored deadline (${stored}) is not the instant that was saved (${iso})`,
  );

  // THE assertion: echo back what `get` returned, exactly as a resumed screen
  // does. `z.string().datetime({ offset: true })` rejected this raw PG text.
  await caller.examDrafts.save({
    ...base,
    cursor: 1,
    elapsedSeconds: 60,
    deadlineAt: stored,
    token: read?.lastSavedAt ?? "",
  });

  const again = await caller.examDrafts.get({ mode: "real" });
  check(again?.deadlineAt === stored, "(p) the echoed save changed or erased the deadline");
  check(again?.cursor === 1, "(p) the echoed save did not land");

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (p) deadlineAt save → get → save (verbatim echo) round-trip OK");
}

/** The columns every prova real save in this file repeats. */
function realBase(questions: SmokeQuestion[]): {
  mode: "real";
  setup: { mode: "real" };
  questionIds: string[];
  modeState: { mode: "real" };
  /** Always 0 — the real exam's clock is the absolute `deadline_at` (D8). */
  elapsedSeconds: 0;
  answers: never[];
} {
  return {
    mode: "real",
    setup: { mode: "real" },
    questionIds: questions.map((q) => q.id),
    modeState: { mode: "real" },
    elapsedSeconds: 0,
    answers: [],
  };
}

/**
 * (t) The 60 s HEARTBEAT and the debt it carries (slice S2d, #79).
 *
 * `examDrafts.touch` moves `last_saved_at` exactly like `save` does — it is the
 * same optimistic token — so a caller that beats without writing the new token
 * back is holding a dead one. Proven in BOTH directions, because only the pair
 * is the contract: the pre-heartbeat token must be REFUSED (or the guard is not
 * guarding), and the post-heartbeat token must be ACCEPTED (or the heartbeat
 * itself is what ends the student's autosave, which is the failure mode the
 * client-side skip + serialization exist to prevent).
 */
export async function assertHeartbeatRotatesTheToken(
  caller: SmokeCaller,
  db: SmokeDb,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const base = realBase(questions);
  const deadlineAt = new Date(Date.now() + 5 * 3_600_000).toISOString();

  const first = await caller.examDrafts.save({ ...base, cursor: 0, deadlineAt, token: null });
  const beaten = await caller.examDrafts.touch({ mode: "real", token: first.lastSavedAt });
  check(
    beaten.lastSavedAt !== first.lastSavedAt,
    "(t) touch did not move last_saved_at — the heartbeat is not a heartbeat",
  );

  check(
    await raises("CONFLICT", () =>
      caller.examDrafts.save({ ...base, cursor: 1, deadlineAt, token: first.lastSavedAt }),
    ),
    "(t) a save carrying the PRE-heartbeat token was accepted — the token guard is off",
  );

  await caller.examDrafts.save({ ...base, cursor: 2, deadlineAt, token: beaten.lastSavedAt });
  const read = await caller.examDrafts.get({ mode: "real" });
  check(read?.cursor === 2, "(t) the save carrying the POST-heartbeat token did not land");
  check(read?.deadlineAt != null, "(t) the heartbeat erased the deadline");

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (t) touch rotates the token: old ⇒ CONFLICT, new ⇒ accepted OK");
}

/**
 * (u) The CLIENT's own auto-submit when the 5 h timer reaches zero
 * (slice S2d, #79): `examDrafts.processReal` is the same `settleRealRun` the
 * server runs lazily — one run, one session, whichever door it leaves by.
 *
 * The draft is written through `save` (not `db.insert`) on purpose: that is the
 * path a real browser takes, deadline normalisation and all. The second call is
 * the load-bearing half — with the tab open AND the server settling lazily,
 * both can fire for one run, and `settled: false` (never a duplicate session)
 * is what says the draft DELETE really is the mutex.
 */
export async function assertClientProcessRealRecordsOnce(
  caller: SmokeCaller,
  db: SmokeDb,
  userId: string,
  questions: SmokeQuestion[],
): Promise<void> {
  const [first] = questions;
  if (first === undefined) throw new Error("[smoke] exam_drafts needs at least one question");

  await caller.examDrafts.save({
    ...realBase(questions),
    cursor: 0,
    answers: [
      { questionId: first.id, userAnswer: first.options[0] ?? "A", correct: true, timeSpent: 0 },
    ],
    // Already expired: the browser's timer would have hit zero.
    deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    token: null,
  });

  const sessionsBefore = await countRows(db, studySessions, userId);
  const settled = await caller.examDrafts.processReal();
  check(settled.settled, "(u) processReal left an EXPIRED prova real unsettled");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "(u) the client auto-submit did not create exactly one session",
  );

  const [filed] = await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, settled.sessionId ?? ""));
  check(filed !== undefined, "(u) processReal returned a session id with no row behind it");
  check(
    filed?.discipline === REAL_EXAM_DISCIPLINE && filed.difficulty === REAL_EXAM_DIFFICULTY,
    `(u) the auto-submitted run was filed as "${String(filed?.discipline)}"/"${String(filed?.difficulty)}" (BR-05.5)`,
  );
  check((await countRows(db, examDrafts, userId)) === 0, "(u) the draft row survived processReal");

  // The other door firing for the same run: nothing left to claim.
  const again = await caller.examDrafts.processReal();
  check(!again.settled, "(u) a SECOND processReal settled a run that was already processed");
  check(
    (await countRows(db, studySessions, userId)) === sessionsBefore + 1,
    "(u) the second processReal wrote a twin session",
  );

  await db.delete(examDrafts).where(eq(examDrafts.userId, userId));
  console.warn("[smoke] (u) client processReal: 1 session, draft consumed, second call no-ops OK");
}
