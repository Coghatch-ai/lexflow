// shared/domain/exam-draft.test.ts
//
// The pure rules behind server-side persistence of an in-flight exam draft (BR-05,
// epic #67 S2a). Plain vitest — no jsdom, no RTL, no DB.

import { describe, expect, it } from "vitest";
import type { AdaptiveState } from "./adaptive";
import {
  REAL_EXAM_DIFFICULTY,
  REAL_EXAM_DISCIPLINE,
  REAL_EXAM_DURATION_SECONDS,
  REAL_RUN_STALE_SECONDS,
  RESUMABLE_MODES,
  answeredOf,
  answersForRecord,
  draftTotalOf,
  filingForClaimedMode,
  isRealRunAbandoned,
  isResumableMode,
  realMountDecision,
  realSecondsLeft,
  reconcileRun,
  resumeCursor,
  type AnswerDraft,
  type ExamDraftSnapshot,
  type RunMode,
} from "./exam-draft";

function answer(questionId: string, userAnswer: string, correct = true): AnswerDraft {
  return { questionId, userAnswer, correct, timeSpent: 30 };
}

/** An adaptive ladder mid-run — `draftTotalOf` never reads it, the shape does. */
const ADAPTIVE_STATE: AdaptiveState = {
  currentDifficulty: "medium",
  consecutiveCorrect: 1,
  consecutiveWrong: 0,
  totalCorrect: 2,
  totalAnswered: 3,
  difficultyHistory: ["medium", "medium", "easy"],
};

function draft(partial: Partial<ExamDraftSnapshot> = {}): ExamDraftSnapshot {
  return {
    questionIds: ["q1", "q2", "q3", "q4"],
    cursor: 2,
    answers: [answer("q1", "A"), answer("q2", "B", false)],
    ...partial,
  };
}

describe("isResumableMode (BR-05.5 / BR-05.3)", () => {
  const ALL_MODES: RunMode[] = ["standard", "adaptive", "spaced", "real"];

  it("NEVER resumes a prova real — however fresh the row is", () => {
    expect(isResumableMode("real")).toBe(false);
    expect(RESUMABLE_MODES).not.toContain("real");
  });

  it("resumes each of the three study modes", () => {
    expect(ALL_MODES.filter(isResumableMode)).toEqual(["standard", "adaptive", "spaced"]);
  });

  it("is false for anything that is not a run mode", () => {
    expect(isResumableMode("")).toBe(false);
    expect(isResumableMode("discursive")).toBe(false);
  });
});

describe("filingForClaimedMode (BR-05.5 — the CLAIMED row decides)", () => {
  const asStandard = { discipline: "Direito Civil", difficulty: "medium" as const };

  it("files a claimed prova real as Prova Real/hard, whatever the caller asked", () => {
    // The exact attack: a client holds the real draft's id + token (both come
    // from examDrafts.get) and submits it through sessions.record with its own
    // discipline. The run must still be filed like the settlement files it.
    expect(filingForClaimedMode("real", asStandard)).toEqual({
      discipline: REAL_EXAM_DISCIPLINE,
      difficulty: REAL_EXAM_DIFFICULTY,
    });
  });

  it("leaves every study mode filed exactly as the caller asked", () => {
    for (const mode of ["standard", "adaptive", "spaced"]) {
      expect(filingForClaimedMode(mode, asStandard)).toEqual(asStandard);
    }
  });

  it("leaves a run that claimed NO draft alone", () => {
    expect(filingForClaimedMode(null, asStandard)).toEqual(asStandard);
  });

  it("only ever forces on the exact string 'real'", () => {
    // `mode` is a text column, so this takes untrusted-ish input: anything that
    // is not the real mode keeps the caller's filing.
    expect(filingForClaimedMode("Real", asStandard)).toEqual(asStandard);
    expect(filingForClaimedMode("", asStandard)).toEqual(asStandard);
  });

  it("produces the SAME filing the server-side settlement uses", () => {
    // One run, one filing, whichever door it leaves by — that is the rule.
    expect(filingForClaimedMode("real", { discipline: "x", difficulty: "easy" })).toEqual(
      filingForClaimedMode("real", asStandard),
    );
  });
});

describe("reconcileRun", () => {
  it("keeps everything when the catalog still has every question", () => {
    const result = reconcileRun(draft(), ["q1", "q2", "q3", "q4"]);
    expect(result.questionIds).toEqual(["q1", "q2", "q3", "q4"]);
    expect(result.answers).toHaveLength(2);
    expect(result.cursor).toBe(2);
    expect(result.dropped).toBe(0);
    expect(result.discard).toBe(false);
  });

  it("drops a vanished question from the QUEUE and from the ANSWERS", () => {
    // q2 left the catalog: keeping its answer would break the
    // user_answers.question_id FK and take the whole transaction down.
    const result = reconcileRun(draft(), ["q1", "q3", "q4"]);
    expect(result.questionIds).toEqual(["q1", "q3", "q4"]);
    expect(result.answers.map((a) => a.questionId)).toEqual(["q1"]);
    expect(result.dropped).toBe(1);
  });

  it("re-anchors the cursor onto the SAME question the student was on", () => {
    // cursor 2 = "q3"; q1 disappears, so q3 is now index 1.
    const result = reconcileRun(draft(), ["q2", "q3", "q4"]);
    expect(result.questionIds[result.cursor]).toBe("q3");
    expect(result.cursor).toBe(1);
  });

  it("re-anchors onto the survivor that took the place of a vanished cursor", () => {
    // cursor 2 = "q3" and q3 itself is gone: the student lands on q4, which is
    // the first survivor at or after the old position — never back at the top.
    const result = reconcileRun(draft(), ["q1", "q2", "q4"]);
    expect(result.questionIds[result.cursor]).toBe("q4");
  });

  it("signals discard when nothing survives", () => {
    const result = reconcileRun(draft(), []);
    expect(result.discard).toBe(true);
    expect(result.questionIds).toEqual([]);
    expect(result.answers).toEqual([]);
    expect(result.cursor).toBe(0);
  });

  // The adaptive mode serves the SAME question twice on purpose: `park` leaves
  // it in the served list and `serveDeferred` re-appends it. An `indexOf`
  // re-anchoring answers with the FIRST copy and throws the student back onto a
  // question already answered, so the cursor is positional.
  describe("with a REPEATED question id (the adaptive queue)", () => {
    const repeated: ExamDraftSnapshot = {
      // q2 was postponed at index 1 and came back at index 3.
      questionIds: ["q1", "q2", "q3", "q2", "q4"],
      cursor: 3,
      answers: [answer("q1", "A"), answer("q3", "C")],
    };

    it("keeps a cursor on the SECOND occurrence on the second occurrence", () => {
      const result = reconcileRun(repeated, ["q1", "q2", "q3", "q4"]);
      expect(result.questionIds).toEqual(["q1", "q2", "q3", "q2", "q4"]);
      expect(result.cursor).toBe(3);
      expect(result.questionIds[result.cursor]).toBe("q2");
    });

    it("keeps the student on the same COPY when a neighbour leaves the catalog", () => {
      // q3 (index 2, before the cursor) is gone: the second q2 is now index 2.
      const result = reconcileRun(repeated, ["q1", "q2", "q4"]);
      expect(result.questionIds).toEqual(["q1", "q2", "q2", "q4"]);
      expect(result.cursor).toBe(2);
      expect(result.questionIds[result.cursor]).toBe("q2");
      // Still the SECOND copy — a first-occurrence anchor would say 1 here.
      expect(result.questionIds.indexOf("q2")).toBe(1);
    });

    it("drops BOTH copies when the repeated question leaves the catalog", () => {
      const result = reconcileRun(repeated, ["q1", "q3", "q4"]);
      expect(result.questionIds).toEqual(["q1", "q3", "q4"]);
      expect(result.dropped).toBe(2);
      // Two survivors sat before the cursor, so the student lands on q4.
      expect(result.questionIds[result.cursor]).toBe("q4");
    });
  });
});

describe("draftTotalOf (the N of 'Continuar (n/N)')", () => {
  const questionIds = ["q1", "q2", "q3"];

  it("uses the SETUP total for an adaptive run, never the served count", () => {
    // The adaptive queue grows one entry per question served: reading its
    // length would offer "Continuar (3/3)" for a simulado of 10.
    expect(
      draftTotalOf({
        questionIds,
        modeState: {
          mode: "adaptive",
          adaptive: ADAPTIVE_STATE,
          totalQuestions: 10,
          deferredIds: [],
        },
      }),
    ).toBe(10);
  });

  it("counts the frozen queue for the standard mode", () => {
    expect(draftTotalOf({ questionIds, modeState: { mode: "standard", carriedTime: {} } })).toBe(3);
  });

  it("counts the frozen queue for the spaced mode", () => {
    expect(draftTotalOf({ questionIds, modeState: { mode: "spaced" } })).toBe(3);
  });

  it("counts the frozen queue for the prova real", () => {
    expect(draftTotalOf({ questionIds, modeState: { mode: "real" } })).toBe(3);
  });

  it("counts DUPLICATES in a served adaptive queue as one served question each", () => {
    // The n and the N come from different places on purpose: `answeredOf`
    // counts answers, `draftTotalOf` the target.
    expect(
      draftTotalOf({
        questionIds: ["q1", "q2", "q1"],
        modeState: {
          mode: "adaptive",
          adaptive: ADAPTIVE_STATE,
          totalQuestions: 4,
          deferredIds: ["q1"],
        },
      }),
    ).toBe(4);
  });
});

describe("resumeCursor", () => {
  it("clamps past the end of a shrunken queue", () => {
    expect(resumeCursor(9, 3)).toBe(2);
  });

  it("clamps a negative cursor to the start", () => {
    expect(resumeCursor(-4, 3)).toBe(0);
  });

  it("returns 0 for an empty queue", () => {
    expect(resumeCursor(2, 0)).toBe(0);
  });

  it("leaves a cursor inside the queue untouched", () => {
    expect(resumeCursor(1, 3)).toBe(1);
  });
});

describe("answersForRecord", () => {
  it("never returns a blank answer (BR-05.6 — delegates to processableAnswers)", () => {
    const result = answersForRecord(
      draft({ answers: [answer("q1", "A"), answer("q2", ""), answer("q3", "C")] }),
    );
    expect(result.map((a) => a.questionId)).toEqual(["q1", "q3"]);
    expect(result.every((a) => a.userAnswer.length > 0)).toBe(true);
  });

  it("is empty for a run nobody answered (0 answers ⇒ no session at all)", () => {
    expect(answersForRecord(draft({ answers: [answer("q1", ""), answer("q2", "")] }))).toEqual([]);
  });
});

describe("answeredOf", () => {
  it("counts ANSWERED questions, not the queue length", () => {
    expect(answeredOf(draft({ questionIds: ["q1", "q2", "q3", "q4", "q5"] }))).toBe(2);
  });

  it("does not count a blank as answered", () => {
    expect(answeredOf(draft({ answers: [answer("q1", "A"), answer("q2", "")] }))).toBe(1);
  });
});

describe("isRealRunAbandoned", () => {
  const now = "2026-08-21T12:00:00.000Z";

  it("true once the deadline has passed", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: "2026-08-21T11:59:59.000Z",
        lastSavedAt: "2026-08-21T11:59:50.000Z", // heartbeat is fresh
        now,
      }),
    ).toBe(true);
  });

  it("true when the heartbeat is older than staleSeconds (dead tab)", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: "2026-08-21T16:00:00.000Z", // hours of exam left
        lastSavedAt: "2026-08-21T11:56:00.000Z", // 4 min = 3 missed beats
        now,
      }),
    ).toBe(true);
  });

  // THE negative case: without it, a student who merely opened another tab
  // gets auto-submitted and loses the rest of the prova real.
  it("FALSE with a fresh heartbeat before the deadline", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: "2026-08-21T16:00:00.000Z",
        lastSavedAt: "2026-08-21T11:59:30.000Z", // 30 s ago
        now,
      }),
    ).toBe(false);
  });

  it("false exactly at the stale boundary, true one second past it", () => {
    const atBoundary = new Date(Date.parse(now) - REAL_RUN_STALE_SECONDS * 1000).toISOString();
    const pastBoundary = new Date(
      Date.parse(now) - (REAL_RUN_STALE_SECONDS + 1) * 1000,
    ).toISOString();
    expect(isRealRunAbandoned({ deadlineAt: null, lastSavedAt: atBoundary, now })).toBe(false);
    expect(isRealRunAbandoned({ deadlineAt: null, lastSavedAt: pastBoundary, now })).toBe(true);
  });

  it("honours a custom staleSeconds", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: null,
        lastSavedAt: "2026-08-21T11:59:00.000Z", // 60 s ago
        now,
        staleSeconds: 30,
      }),
    ).toBe(true);
  });

  it("false on an unparseable timestamp — never auto-submit on a guess", () => {
    expect(isRealRunAbandoned({ deadlineAt: null, lastSavedAt: "not-a-date", now })).toBe(false);
  });

  // The half `Date.parse` would wave through: values that are not garbage
  // enough to answer NaN, only wrong enough to mean something else. `"2026"`
  // parses as 1 Jan 2026, so a lenient read of it force-submits an exam that
  // has not started yet. Postgres refuses these (22007 / 22023) and
  // `examDrafts.save` normalises them, so a row carrying one is legacy or
  // hand-written — and a legacy row must not be read as "abandoned".
  it("false on a PARTIAL deadline — `2026` is a year, not an instant", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: "2026",
        lastSavedAt: "2026-08-21T11:59:30.000Z", // heartbeat is fresh
        now,
      }),
    ).toBe(false);
  });

  it("false on a `Date.toString()` deadline — a locale-shaped guess", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: new Date("2026-08-21T11:00:00.000Z").toString(), // an hour PAST
        lastSavedAt: "2026-08-21T11:59:30.000Z",
        now,
      }),
    ).toBe(false);
  });

  it("false on a partial `lastSavedAt` — a stale heartbeat must be measured, not guessed", () => {
    expect(isRealRunAbandoned({ deadlineAt: null, lastSavedAt: "2026", now })).toBe(false);
  });

  it("false on a partial `now` — the clock this is judged against is read strictly too", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: null,
        lastSavedAt: "2026-08-21T11:59:30.000Z",
        now: "2027",
      }),
    ).toBe(false);
  });

  // The other side of failing closed: an unreadable DEADLINE disables only the
  // deadline half. A heartbeat that is readable AND quiet still settles, so a
  // corrupt `deadline_at` cannot keep a dead run alive forever.
  it("true on an unreadable deadline when the heartbeat is readable and quiet", () => {
    expect(
      isRealRunAbandoned({
        deadlineAt: "2026",
        lastSavedAt: "2026-08-21T11:56:00.000Z", // 4 min = 3 missed beats
        now,
      }),
    ).toBe(true);
  });
});

// The prova real's clock (epic #67 slice S2d, #79). It is DERIVED from the
// absolute `deadline_at`, never counted locally: reloading the tab must not
// hand back time (criterion 5) and the exam does not pause.
describe("realSecondsLeft", () => {
  const now = "2026-08-21T12:00:00.000Z";

  it("counts down to the absolute deadline", () => {
    expect(realSecondsLeft({ deadlineAt: "2026-08-21T13:00:00.000Z", now })).toBe(3600);
  });

  it("is the full 5 h at the instant the exam starts", () => {
    const deadlineAt = new Date(Date.parse(now) + REAL_EXAM_DURATION_SECONDS * 1000).toISOString();
    expect(realSecondsLeft({ deadlineAt, now })).toBe(REAL_EXAM_DURATION_SECONDS);
  });

  it("floors at 0 — a deadline in the past is never a NEGATIVE countdown", () => {
    expect(realSecondsLeft({ deadlineAt: "2026-08-21T11:00:00.000Z", now })).toBe(0);
  });

  it("is 0 exactly at the deadline", () => {
    expect(realSecondsLeft({ deadlineAt: now, now })).toBe(0);
  });

  it("reads the raw PG text the API hands back, microseconds and all", () => {
    // `examDrafts.get` returns "2026-08-21 13:00:04.210932+00" (drizzle
    // overrides the TIMESTAMPTZ parser to identity) — the value a rehydrating
    // screen actually holds. Refusing it would blank the clock on every reload.
    expect(realSecondsLeft({ deadlineAt: "2026-08-21 13:00:04.210932+00", now })).toBe(3604);
  });

  it("is null with no deadline at all — 'do not decide', never '0 left'", () => {
    expect(realSecondsLeft({ deadlineAt: null, now })).toBeNull();
  });

  it("is null for the two values Postgres itself refuses", () => {
    // `Date.parse` accepts both — "2026" as 1 Jan 2026 (a whole YEAR read as an
    // instant) and a JS Date.toString() as a locale-shaped guess — which is
    // exactly why the check is stricter than `Date.parse` here.
    expect(realSecondsLeft({ deadlineAt: "2026", now })).toBeNull();
    expect(
      realSecondsLeft({ deadlineAt: new Date("2026-08-21T13:00:00.000Z").toString(), now }),
    ).toBeNull();
  });

  it("is null when `now` itself is unreadable", () => {
    expect(realSecondsLeft({ deadlineAt: "2026-08-21T13:00:00.000Z", now: "amanhã" })).toBeNull();
  });
});

// BR-05.5 on mount: a prova real is NEVER offered back to continue — it is
// resumed only by the tab that owns it, or settled, or replaced.
describe("realMountDecision", () => {
  const now = "2026-08-21T12:00:00.000Z";
  const future = "2026-08-21T16:00:00.000Z";

  it("start: no row at all", () => {
    expect(realMountDecision({ draft: null, now })).toBe("start");
  });

  // THE negative case: without it, a student who merely opened the dashboard in
  // a second tab comes back to an auto-submitted exam (criterion 6).
  it("resume: FRESH heartbeat before the deadline — the owning tab reloading", () => {
    expect(
      realMountDecision({
        draft: { deadlineAt: future, lastSavedAt: "2026-08-21T11:59:30.000Z" },
        now,
      }),
    ).toBe("resume");
  });

  it("settle: the deadline passed while the tab was closed", () => {
    expect(
      realMountDecision({
        draft: { deadlineAt: "2026-08-21T11:59:59.000Z", lastSavedAt: "2026-08-21T11:59:50.000Z" },
        now,
      }),
    ).toBe("settle");
  });

  it("settle: the heartbeat went quiet for 3 beats — dead tab", () => {
    expect(
      realMountDecision({
        draft: { deadlineAt: future, lastSavedAt: "2026-08-21T11:56:00.000Z" },
        now,
      }),
    ).toBe("settle");
  });

  it("start: a row whose deadline cannot be read is never auto-submitted", () => {
    // The next `startReal` settles this orphan with `force`. Guessing here
    // would end an exam that may still be being taken.
    expect(
      realMountDecision({
        draft: { deadlineAt: null, lastSavedAt: "2026-08-21T11:59:30.000Z" },
        now,
      }),
    ).toBe("start");
    // ...and "cannot be read" means the STRICT read. `"2026"` is a year that
    // `Date.parse` happily calls 1 Jan 2026 — settling on it force-submits an
    // exam whose deadline nobody actually knows. Same verdict as `null`,
    // because the two are the same amount of information.
    expect(
      realMountDecision({
        draft: { deadlineAt: "2026", lastSavedAt: "2026-08-21T11:59:30.000Z" },
        now,
      }),
    ).toBe("start");
    expect(
      realMountDecision({
        draft: {
          deadlineAt: new Date("2026-08-21T11:00:00.000Z").toString(),
          lastSavedAt: "2026-08-21T11:59:30.000Z",
        },
        now,
      }),
    ).toBe("start");
  });

  // Failing closed on the deadline does NOT strand the row: the heartbeat is a
  // second, independent judgement, and a quiet one still settles.
  it("settle: unreadable deadline but a heartbeat that went quiet", () => {
    expect(
      realMountDecision({
        draft: { deadlineAt: "2026", lastSavedAt: "2026-08-21T11:56:00.000Z" },
        now,
      }),
    ).toBe("settle");
  });

  it("settle at exactly 0 seconds left, resume at 1", () => {
    const lastSavedAt = "2026-08-21T11:59:30.000Z";
    expect(realMountDecision({ draft: { deadlineAt: now, lastSavedAt }, now })).toBe("settle");
    expect(
      realMountDecision({ draft: { deadlineAt: "2026-08-21T12:00:01.000Z", lastSavedAt }, now }),
    ).toBe("resume");
  });

  it("honours a custom staleSeconds, like isRealRunAbandoned", () => {
    expect(
      realMountDecision({
        draft: { deadlineAt: future, lastSavedAt: "2026-08-21T11:59:00.000Z" },
        now,
        staleSeconds: 30,
      }),
    ).toBe("settle");
  });
});
