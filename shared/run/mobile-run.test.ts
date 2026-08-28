// The mobile runner's BR-05 mapping (#86 M2b), hermetic: plain vitest, node
// environment, no React and no tRPC — which is why this logic lives in
// `shared/run/` and not in `apps/mobile/` (`vitest.config.ts` does not include
// `apps/mobile/**`, so a test written there never runs at all).

import { describe, expect, it } from "vitest";
import { moveToEnd } from "../domain/exam-queue";
import type { AnswerDraft } from "../domain/exam-draft";
import type { PersistedDraft } from "./run-persistence";
import {
  mobileCursor,
  mobileDraftPayload,
  mobileElapsedSeconds,
  mobileResume,
  mobileRunMode,
  type MobileRunState,
} from "./mobile-run";

// The RAW PostgreSQL text of `exam_drafts.last_saved_at` — microseconds, a
// space instead of `T`, `+00` instead of `Z`. Matched with `=` in SQL, so any
// normalisation on the way through silently stops the guard from guarding.
const PG_TOKEN = "2026-08-21 14:30:04.210932+00";

function answer(id: string, userAnswer = "A", timeSpent = 10): AnswerDraft {
  return { questionId: id, userAnswer, correct: true, timeSpent };
}

function state(overrides: Partial<MobileRunState> = {}): MobileRunState {
  return {
    surface: "practice",
    discipline: "CIVIL_LAW",
    questionIds: ["q1", "q2", "q3"],
    answers: [answer("q1")],
    carriedTime: new Map([["q2", 42]]),
    ...overrides,
  };
}

/** The row `examDrafts.get` hands back for a payload this module just built. */
function rowOf(payload: ReturnType<typeof mobileDraftPayload>): PersistedDraft {
  return {
    id: "3f1c2d5e-0000-4000-8000-000000000042",
    mode: payload.mode,
    setup: payload.setup,
    questionIds: payload.questionIds,
    cursor: payload.cursor,
    answers: payload.answers,
    modeState: payload.modeState,
    elapsedSeconds: payload.elapsedSeconds,
    deadlineAt: null,
    lastSavedAt: PG_TOKEN,
  };
}

const CATALOG = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];

describe("mobileDraftPayload — the queue that is persisted", () => {
  // 1. The REORDERED queue, and the cursor on the next unanswered question.
  it("persists the postponed order and points the cursor at the next unanswered", () => {
    // [q1,q2,q3] → answer q1 → postpone q2 → the run's own queue is [q1,q3,q2].
    const queue = moveToEnd(["q1", "q2", "q3"], 1);
    expect(queue).toEqual(["q1", "q3", "q2"]);

    const payload = mobileDraftPayload(
      state({ questionIds: queue, answers: [answer("q1")] }),
      PG_TOKEN,
    );

    // The `questions` PROP is still [q1,q2,q3]; persisting that would hand the
    // student back q2 — the question they postponed — ahead of q3.
    expect(payload.questionIds).toEqual(["q1", "q3", "q2"]);
    expect(payload.cursor).toBe(1);
    expect(payload.questionIds[payload.cursor]).toBe("q3");
  });

  it("puts the cursor on the last question once everything is answered", () => {
    const answers = [answer("q1"), answer("q2"), answer("q3")];
    expect(mobileCursor(["q1", "q2", "q3"], answers)).toBe(2);
  });

  // 2. The token travels verbatim, character for character.
  it("carries the token verbatim", () => {
    const payload = mobileDraftPayload(state(), PG_TOKEN);
    expect(payload.token).toBe(PG_TOKEN);
    expect(payload.token).toStrictEqual("2026-08-21 14:30:04.210932+00");
  });

  it("carries a null token before the first save", () => {
    expect(mobileDraftPayload(state(), null).token).toBeNull();
  });

  // 3. One entry per question (last word wins) and never a blank answer.
  it("collapses a repeated answer onto the last one and drops blanks", () => {
    const payload = mobileDraftPayload(
      state({
        answers: [
          answer("q1", "A"),
          answer("q1", "C"),
          { questionId: "q2", userAnswer: "", correct: false, timeSpent: 7 },
        ],
      }),
      PG_TOKEN,
    );

    expect(payload.answers).toHaveLength(1);
    expect(payload.answers[0]?.questionId).toBe("q1");
    expect(payload.answers[0]?.userAnswer).toBe("C");
    // A blank is not an error and is never recorded (BR-05.6 / BR-03) — so the
    // cursor still stands on q2, which is unanswered.
    expect(payload.cursor).toBe(1);
  });

  it("sums only the measured seconds of processable answers", () => {
    const answers = [
      answer("q1", "A", 30),
      answer("q1", "C", 45),
      { questionId: "q2", userAnswer: "", correct: false, timeSpent: 900 },
    ];
    expect(mobileElapsedSeconds(answers)).toBe(45);
    const payload = mobileDraftPayload(state({ answers }), PG_TOKEN);
    expect(payload.mode).toBe("standard");
    if (payload.mode === "standard") expect(payload.elapsedSeconds).toBe(45);
  });
});

describe("mobileResume — the round trip", () => {
  // 4. Save then resume: same cursor question, same answers, same queue order.
  it("returns the same cursor question and the same answers", () => {
    const queue = moveToEnd(["q1", "q2", "q3"], 1);
    const payload = mobileDraftPayload(
      state({ questionIds: queue, answers: [answer("q1", "B", 33)] }),
      PG_TOKEN,
    );

    const resumed = mobileResume(rowOf(payload), CATALOG);

    expect(resumed.discard).toBe(false);
    if (resumed.discard) return;
    expect(resumed.questions.map((q) => q.id)).toEqual(["q1", "q3", "q2"]);
    expect(resumed.cursor).toBe(payload.cursor);
    expect(resumed.questions[resumed.cursor]?.id).toBe("q3");
    expect(resumed.answers).toEqual([answer("q1", "B", 33)]);
    expect(resumed.carriedTime.get("q2")).toBe(42);
    expect(resumed.elapsedSeconds).toBe(33);
    expect(resumed.discipline).toBe("CIVIL_LAW");
    expect(resumed.dropped).toBe(0);
  });

  it("round-trips a review run through the spaced resume", () => {
    const payload = mobileDraftPayload(
      state({ surface: "review", answers: [answer("q1"), answer("q2")] }),
      PG_TOKEN,
    );
    const resumed = mobileResume(rowOf(payload), CATALOG);

    expect(resumed.discard).toBe(false);
    if (resumed.discard) return;
    expect(resumed.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(resumed.cursor).toBe(2);
    // The spaced `modeState` carries no `carriedTime` and no run clock (D8).
    expect(resumed.carriedTime.size).toBe(0);
    expect(resumed.elapsedSeconds).toBe(0);
    expect(resumed.discipline).toBeNull();
  });

  it("discards a run whose questions all left the catalog", () => {
    const payload = mobileDraftPayload(state(), PG_TOKEN);
    const resumed = mobileResume(rowOf(payload), []);
    expect(resumed.discard).toBe(true);
    expect(resumed.dropped).toBe(3);
  });
});

describe("mobileRunMode — the surface → saved mode map", () => {
  // 5. The product owner's rule (#86 EMENDA): same database, same BR-05.
  // Praticar AND Treino focado save as `standard`; Revisão saves as `spaced`.
  it("maps Praticar and Drill to standard, Revisão to spaced", () => {
    expect(mobileRunMode("practice")).toBe("standard");
    expect(mobileRunMode("drill")).toBe("standard");
    expect(mobileRunMode("review")).toBe("spaced");
  });

  it("builds the SAME payload mode for Praticar and Drill", () => {
    const practice = mobileDraftPayload(state({ surface: "practice" }), PG_TOKEN);
    const drill = mobileDraftPayload(state({ surface: "drill" }), PG_TOKEN);

    expect(practice.mode).toBe("standard");
    expect(drill.mode).toBe("standard");
    // Same slot, so the payloads are indistinguishable by mode — that is the
    // rule (one `UNIQUE(user_id, mode)` row shared with Praticar), which is why
    // starting one over the other lands in BR-05.8 instead of overwriting.
    expect(drill).toEqual(practice);
  });

  it("never invents a mobile-only mode and never writes the prova real's", () => {
    for (const surface of ["practice", "drill", "review"] as const) {
      const { mode } = mobileDraftPayload(state({ surface }), PG_TOKEN);
      expect(["standard", "spaced"]).toContain(mode);
      expect(mode).not.toBe("real");
      expect(mode.startsWith("mobile")).toBe(false);
    }
  });
});
