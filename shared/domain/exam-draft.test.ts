// shared/domain/exam-draft.test.ts
//
// The pure rules behind server-side persistence of an in-flight exam draft (BR-05,
// epic #67 S2a). Plain vitest — no jsdom, no RTL, no DB.

import { describe, expect, it } from "vitest";
import {
  REAL_RUN_STALE_SECONDS,
  RESUMABLE_MODES,
  answeredOf,
  answersForRecord,
  isRealRunAbandoned,
  isResumableMode,
  reconcileRun,
  resumeCursor,
  type AnswerDraft,
  type ExamDraftSnapshot,
  type RunMode,
} from "./exam-draft";

function answer(questionId: string, userAnswer: string, correct = true): AnswerDraft {
  return { questionId, userAnswer, correct, timeSpent: 30 };
}

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
});
