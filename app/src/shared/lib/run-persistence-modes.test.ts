// app/src/shared/lib/run-persistence-modes.test.ts
//
// The Revisão Espaçada and Simulado Adaptativo halves of `run-persistence.ts`
// (BR-05, epic #67 slice S2c): what each mode's payload carries, what its
// resume rebuilds, and the `'busy'` refusal. Plain vitest — no jsdom, no RTL.
//
// A separate file from `run-persistence.test.ts` only because that one is at
// the 500-line ESLint cap; same module under test, same fixtures shape.

import { describe, expect, it } from "vitest";
import { moveToEnd } from "./exam-queue";
import {
  adaptiveDraftPayload,
  realDraftPayload,
  resumeAdaptiveFrom,
  resumeRealFrom,
  resumeSpacedFrom,
  runSaveFailure,
  saveFailureFor,
  spacedDraftPayload,
  type AdaptiveRunState,
  type PersistedDraft,
  type RealRunState,
  type SpacedRunState,
} from "./run-persistence";
import type { AdaptiveState } from "@shared/domain/adaptive";
import type { AnswerDraft } from "@shared/domain/exam-draft";

// The RAW PostgreSQL text of `exam_drafts.last_saved_at` — microseconds, a
// space instead of `T`, `+00` instead of `Z`. The column is matched with `=`
// in SQL, so every payload must echo it untouched.
const PG_TOKEN = "2026-08-21 14:30:04.210932+00";

function answer(id: string, userAnswer = "A", timeSpent = 10): AnswerDraft {
  return { questionId: id, userAnswer, correct: true, timeSpent };
}

function draft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: "3f1c2d5e-0000-4000-8000-000000000001",
    mode: "standard",
    setup: { mode: "standard", discipline: "CIVIL_LAW", examBoard: "FGV", difficulty: null },
    questionIds: ["q1", "q2", "q3"],
    cursor: 1,
    answers: [answer("q1")],
    modeState: { mode: "standard", carriedTime: { q2: 42 } },
    elapsedSeconds: 130,
    deadlineAt: null,
    lastSavedAt: PG_TOKEN,
    ...overrides,
  };
}

/** A ladder that has already climbed — a resume must not restart it. */
const LADDER: AdaptiveState = {
  currentDifficulty: "hard",
  consecutiveCorrect: 2,
  consecutiveWrong: 0,
  totalCorrect: 3,
  totalAnswered: 4,
  difficultyHistory: ["medium", "medium", "hard", "hard"],
};

function spacedRun(overrides: Partial<SpacedRunState> = {}): SpacedRunState {
  return {
    questionIds: ["r1", "r2", "r3"],
    cursor: 1,
    answers: [answer("r1")],
    token: PG_TOKEN,
    ...overrides,
  };
}

function adaptiveRun(overrides: Partial<AdaptiveRunState> = {}): AdaptiveRunState {
  return {
    setup: { discipline: "CIVIL_LAW", totalQuestions: 10 },
    // a2 was postponed and served again at the tail — the duplicate is normal.
    questionIds: ["a1", "a2", "a3", "a2"],
    cursor: 3,
    answers: [answer("a1"), answer("a3")],
    adaptive: LADDER,
    deferredIds: [],
    elapsedSeconds: 240,
    token: PG_TOKEN,
    ...overrides,
  };
}

describe("spacedDraftPayload", () => {
  it("persists ONLY the universal columns: setup and modeState are bare (D8)", () => {
    const payload = spacedDraftPayload(spacedRun());
    expect(payload.setup).toEqual({ mode: "spaced" });
    expect(payload.modeState).toEqual({ mode: "spaced" });
    expect(payload.mode).toBe("spaced");
  });

  it("returns the token VERBATIM, like every other payload", () => {
    const payload = spacedDraftPayload(spacedRun());
    expect(payload.token).toBe(PG_TOKEN);
    expect(payload.token).not.toBe(new Date(PG_TOKEN).toISOString());
    expect(spacedDraftPayload(spacedRun({ token: null })).token).toBeNull();
  });

  it("sends elapsedSeconds 0 — the review has no run clock to invent", () => {
    expect(spacedDraftPayload(spacedRun()).elapsedSeconds).toBe(0);
  });

  it("keeps the queue order a 'Responder depois' produced (BR-03)", () => {
    const reordered = moveToEnd(["r1", "r2", "r3"], 0);
    expect(spacedDraftPayload(spacedRun({ questionIds: reordered })).questionIds).toEqual([
      "r2",
      "r3",
      "r1",
    ]);
  });

  it("never sends deadlineAt, and copies the arrays instead of aliasing them", () => {
    const questionIds = ["r1", "r2"];
    const payload = spacedDraftPayload(spacedRun({ questionIds }));
    questionIds.push("r3");
    expect("deadlineAt" in payload).toBe(false);
    expect(payload.questionIds).toEqual(["r1", "r2"]);
  });
});

describe("adaptiveDraftPayload", () => {
  it("carries the ladder VERBATIM — that is what makes the resume identical", () => {
    const payload = adaptiveDraftPayload(adaptiveRun());
    expect(payload.modeState.adaptive).toEqual(LADDER);
    expect(payload.modeState.totalQuestions).toBe(10);
    expect(payload.setup).toEqual({
      mode: "adaptive",
      discipline: "CIVIL_LAW",
      totalQuestions: 10,
    });
  });

  it("persists the served list WITH its duplicate — the cursor is a position", () => {
    const payload = adaptiveDraftPayload(adaptiveRun());
    expect(payload.questionIds).toEqual(["a1", "a2", "a3", "a2"]);
    expect(payload.cursor).toBe(3);
  });

  it("keeps deferredIds in FIFO order and ⊆ questionIds", () => {
    const payload = adaptiveDraftPayload(
      adaptiveRun({
        questionIds: ["a1", "a2", "a3"],
        // "ghost" is not in the served list: it could never be served back and
        // would only hold a slot open in `shouldServeDeferred`.
        deferredIds: ["a3", "ghost", "a1"],
      }),
    );
    expect(payload.modeState.deferredIds).toEqual(["a3", "a1"]);
    expect(payload.modeState.deferredIds.every((id) => payload.questionIds.includes(id))).toBe(
      true,
    );
  });

  it("returns the token VERBATIM and never sends deadlineAt", () => {
    const payload = adaptiveDraftPayload(adaptiveRun());
    expect(payload.token).toBe(PG_TOKEN);
    expect("deadlineAt" in payload).toBe(false);
    expect(adaptiveDraftPayload(adaptiveRun({ token: null })).token).toBeNull();
  });

  it("agrees with itself on the three discriminators (the router refuses otherwise)", () => {
    const payload = adaptiveDraftPayload(adaptiveRun());
    expect(payload.mode).toBe("adaptive");
    expect(payload.setup.mode).toBe("adaptive");
    expect(payload.modeState.mode).toBe("adaptive");
  });
});

describe("resumeSpacedFrom", () => {
  const spacedDraft = (overrides: Partial<PersistedDraft> = {}): PersistedDraft =>
    draft({
      mode: "spaced",
      setup: { mode: "spaced" },
      modeState: { mode: "spaced" },
      questionIds: ["r1", "r2", "r3"],
      cursor: 1,
      answers: [answer("r1")],
      elapsedSeconds: 0,
      ...overrides,
    });

  it("re-imposes the persisted queue order on the rows byIds returned", () => {
    const state = resumeSpacedFrom(spacedDraft(), [{ id: "r3" }, { id: "r1" }, { id: "r2" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.questions.map((q) => q.id)).toEqual(["r1", "r2", "r3"]);
    expect(state.cursor).toBe(1);
    expect(state.answers.map((a) => a.questionId)).toEqual(["r1"]);
  });

  it("has NO carriedTime and restarts the current review's timer at 0 (D8)", () => {
    const state = resumeSpacedFrom(spacedDraft(), [{ id: "r1" }, { id: "r2" }, { id: "r3" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.timeSpent).toBe(0);
    expect("carriedTime" in state).toBe(false);
    expect("elapsedSeconds" in state).toBe(false);
  });

  it("keeps a postponed review at the TAIL where the saved order put it", () => {
    const state = resumeSpacedFrom(
      spacedDraft({ questionIds: moveToEnd(["r1", "r2", "r3"], 1), cursor: 0 }),
      [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    );
    if (state.discard) throw new Error("unexpected discard");
    expect(state.questions.map((q) => q.id)).toEqual(["r1", "r3", "r2"]);
  });

  it("drops a review that left the catalog and asks for a discard when none survive", () => {
    const partial = resumeSpacedFrom(spacedDraft(), [{ id: "r1" }, { id: "r3" }]);
    if (partial.discard) throw new Error("unexpected discard");
    expect(partial.questions.map((q) => q.id)).toEqual(["r1", "r3"]);
    expect(partial.dropped).toBe(1);
    expect(resumeSpacedFrom(spacedDraft(), [])).toEqual({ discard: true, dropped: 3 });
  });
});

describe("resumeAdaptiveFrom", () => {
  const adaptiveDraft = (overrides: Partial<PersistedDraft> = {}): PersistedDraft =>
    draft({
      mode: "adaptive",
      setup: { mode: "adaptive", discipline: "CIVIL_LAW", totalQuestions: 10 },
      modeState: {
        mode: "adaptive",
        adaptive: LADDER,
        totalQuestions: 10,
        deferredIds: ["a2"],
      },
      questionIds: ["a1", "a2", "a3", "a2"],
      cursor: 3,
      answers: [answer("a1"), answer("a3")],
      elapsedSeconds: 240,
      ...overrides,
    });
  const catalog = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];

  it("replays the served order WITH the duplicate byIds de-duplicated away", () => {
    // `inArray` answers one row per id, in database order: rebuilding from the
    // fetch would lose the second a2 and slide the cursor onto the wrong one.
    const state = resumeAdaptiveFrom(adaptiveDraft(), [{ id: "a3" }, { id: "a2" }, { id: "a1" }]);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.questions.map((q) => q.id)).toEqual(["a1", "a2", "a3", "a2"]);
    expect(state.cursor).toBe(3);
    expect(state.questions[state.cursor]?.id).toBe("a2");
  });

  it("returns the ladder verbatim so the difficulty does NOT restart at medium", () => {
    const state = resumeAdaptiveFrom(adaptiveDraft(), catalog);
    if (state.discard) throw new Error("unexpected discard");
    expect(state.adaptive).toEqual(LADDER);
    expect(state.adaptive.currentDifficulty).toBe("hard");
    expect(state.setup).toEqual({ discipline: "CIVIL_LAW", totalQuestions: 10 });
    expect(state.elapsedSeconds).toBe(240);
    expect(state.timeSpent).toBe(0);
  });

  it("rebuilds the deferred FIFO in its persisted order", () => {
    const state = resumeAdaptiveFrom(
      adaptiveDraft({
        questionIds: ["a1", "a2", "a3"],
        cursor: 2,
        modeState: {
          mode: "adaptive",
          adaptive: LADDER,
          totalQuestions: 10,
          deferredIds: ["a2", "a1"],
        },
      }),
      catalog,
    );
    if (state.discard) throw new Error("unexpected discard");
    expect(state.deferred.map((q) => q.id)).toEqual(["a2", "a1"]);
  });

  it("drops an id that left the catalog from the FIFO **and** from the queue", () => {
    // A parked question nobody can serve would hold a slot open forever in
    // `shouldServeDeferred` and hand `sessions.record` a dead FK.
    const state = resumeAdaptiveFrom(
      adaptiveDraft({
        questionIds: ["a1", "gone", "a3"],
        cursor: 2,
        answers: [answer("a1"), answer("gone")],
        modeState: {
          mode: "adaptive",
          adaptive: LADDER,
          totalQuestions: 10,
          deferredIds: ["gone", "a1"],
        },
      }),
      [{ id: "a1" }, { id: "a3" }],
    );
    if (state.discard) throw new Error("unexpected discard");
    expect(state.questions.map((q) => q.id)).toEqual(["a1", "a3"]);
    expect(state.deferred.map((q) => q.id)).toEqual(["a1"]);
    expect(state.answers.map((a) => a.questionId)).toEqual(["a1"]);
    expect(state.dropped).toBe(1);
  });

  it("asks for a discard when NOTHING survived", () => {
    expect(resumeAdaptiveFrom(adaptiveDraft(), [])).toEqual({ discard: true, dropped: 4 });
  });
});

// The prova real (epic #67 slice S2d, #79). It persists to be AUTO-SUBMITTED,
// never to be offered back (BR-05.5), and it is the only mode whose payload
// carries `deadlineAt` — the absolute clock the auto-submit is judged against.
const REAL_DEADLINE = "2026-08-21T19:30:04.000Z";

function realRun(overrides: Partial<RealRunState> = {}): RealRunState {
  return {
    questionIds: ["q1", "q2", "q3"],
    cursor: 2,
    answers: [answer("q1"), answer("q2", "B")],
    deadlineAt: REAL_DEADLINE,
    token: PG_TOKEN,
    ...overrides,
  };
}

describe("realDraftPayload", () => {
  it("carries the absolute deadlineAt — the whole reason this mode persists", () => {
    expect(realDraftPayload(realRun()).deadlineAt).toBe(REAL_DEADLINE);
  });

  it("echoes the raw PG deadline back verbatim when the screen rehydrated from one", () => {
    // A resumed board holds what `get` returned; the router normalises it.
    const raw = "2026-08-21 19:30:04.210932+00";
    expect(realDraftPayload(realRun({ deadlineAt: raw })).deadlineAt).toBe(raw);
  });

  it("sends elapsedSeconds 0 — the time used is DERIVED from the deadline (D8)", () => {
    expect(realDraftPayload(realRun()).elapsedSeconds).toBe(0);
  });

  it("keeps setup and modeState bare: the only per-mode thing is the deadline column", () => {
    const payload = realDraftPayload(realRun());
    expect(payload.setup).toEqual({ mode: "real" });
    expect(payload.modeState).toEqual({ mode: "real" });
  });

  it("agrees with itself on the three discriminators (the router refuses otherwise)", () => {
    const payload = realDraftPayload(realRun());
    expect(payload.mode).toBe("real");
    expect(payload.setup.mode).toBe("real");
    expect(payload.modeState.mode).toBe("real");
  });

  it("returns the token VERBATIM — no Date, no toISOString", () => {
    const payload = realDraftPayload(realRun());
    expect(payload.token).toBe(PG_TOKEN);
    expect(payload.token).toContain(".210932");
  });

  it("carries a null token on the first save (the one that mints the deadline)", () => {
    expect(realDraftPayload(realRun({ token: null })).token).toBeNull();
  });

  it("DEDUPLICATES by questionId — the real exam re-answers the same question", () => {
    // Unlike the study modes, an answer here is written the moment it is picked
    // and can be changed for 5 h. Two entries for one question would count 4 of
    // 3, write two `user_answers` rows and step SM-2 twice.
    const payload = realDraftPayload(
      realRun({ answers: [answer("q1", "A"), answer("q2", "B"), answer("q1", "C")] }),
    );
    expect(payload.answers).toEqual([
      { questionId: "q1", userAnswer: "C", correct: true, timeSpent: 10 },
      { questionId: "q2", userAnswer: "B", correct: true, timeSpent: 10 },
    ]);
  });

  it("copies the frozen queue instead of aliasing the live array", () => {
    const questionIds = ["q1", "q2"];
    const payload = realDraftPayload(realRun({ questionIds }));
    questionIds.push("q3");
    expect(payload.questionIds).toEqual(["q1", "q2"]);
  });
});

describe("resumeRealFrom", () => {
  function realDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
    return draft({
      mode: "real",
      setup: { mode: "real" },
      modeState: { mode: "real" },
      elapsedSeconds: 0,
      deadlineAt: REAL_DEADLINE,
      answers: [answer("q1"), answer("q2", "B")],
      cursor: 2,
      ...overrides,
    });
  }

  it("re-imposes the frozen queue order and hands the deadline through untouched", () => {
    const resumed = resumeRealFrom(realDraft(), [{ id: "q3" }, { id: "q1" }, { id: "q2" }]);
    if (resumed.discard) throw new Error("expected a resumable prova real");
    expect(resumed.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(resumed.cursor).toBe(2);
    expect(resumed.deadlineAt).toBe(REAL_DEADLINE);
  });

  it("drops answers to questions that left the catalog (the FK would kill the recording)", () => {
    const resumed = resumeRealFrom(realDraft(), [{ id: "q1" }, { id: "q3" }]);
    if (resumed.discard) throw new Error("expected a resumable prova real");
    expect(resumed.answers.map((a) => a.questionId)).toEqual(["q1"]);
    expect(resumed.dropped).toBe(1);
    expect(resumed.cursor).toBe(1);
  });

  it("discards when nothing survived", () => {
    expect(resumeRealFrom(realDraft(), [])).toEqual({ discard: true, dropped: 3 });
  });
});

describe("runSaveFailure('busy')", () => {
  it("has pt-BR copy of its own — the sidebar guard used to fail in silence", () => {
    const busy = runSaveFailure("busy");
    expect(busy.kind).toBe("busy");
    expect(busy.title).toBe("Ainda estamos salvando este teste.");
    expect(busy.body).toContain("nada foi perdido");
    expect(busy.dismissLabel).toBe("Entendi");
  });

  it("is NOT reachable from an error: no code maps to it", () => {
    // `busy` is a local refusal, not a server answer. If `saveFailureFor` could
    // produce it, a real network failure would be shown as "wait a moment".
    for (const thrown of [
      null,
      undefined,
      { data: null },
      { data: { code: "UNAUTHORIZED" } },
      { data: { code: "FORBIDDEN" } },
      { data: { code: "CONFLICT" } },
      { data: { code: "INTERNAL_SERVER_ERROR" } },
      { data: { code: "TOO_MANY_REQUESTS" } },
    ]) {
      expect(saveFailureFor(thrown).kind).not.toBe("busy");
    }
  });
});
