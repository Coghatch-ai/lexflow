import { describe, expect, it } from "vitest";
import {
  canPostponeAdaptive,
  canPostponeGuard,
  findNextUnanswered,
  moveToEnd,
  nextAdaptiveStep,
  shouldServeDeferred,
} from "./exam-queue";
import { DEFAULT_ADAPTIVE_CONFIG, type AdaptiveState } from "@shared/domain/adaptive";

describe("moveToEnd", () => {
  it("moves the element at index to the end, preserving relative order", () => {
    expect(moveToEnd(["a", "b", "c", "d"], 1)).toEqual(["a", "c", "d", "b"]);
    expect(moveToEnd(["a", "b", "c", "d"], 0)).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op permutation for the last index", () => {
    expect(moveToEnd(["a", "b", "c"], 2)).toEqual(["a", "b", "c"]);
  });

  it("preserves length and membership", () => {
    const input = ["q1", "q2", "q3", "q4", "q5"];
    const result = moveToEnd(input, 2);
    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it("does not mutate the input and returns a new reference", () => {
    const input = ["a", "b", "c"];
    const snapshot = [...input];
    const result = moveToEnd(input, 0);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it("returns a copy for out-of-range indices", () => {
    expect(moveToEnd(["a", "b"], -1)).toEqual(["a", "b"]);
    expect(moveToEnd(["a", "b"], 2)).toEqual(["a", "b"]);
    expect(moveToEnd([], 0)).toEqual([]);
  });
});

describe("findNextUnanswered", () => {
  it("returns the next unanswered index after `from`", () => {
    expect(findNextUnanswered(5, 1, new Set([0]))).toBe(2);
  });

  it("skips answered indices", () => {
    expect(findNextUnanswered(5, 1, new Set([2, 3]))).toBe(4);
  });

  it("wraps around past the end", () => {
    expect(findNextUnanswered(5, 3, new Set([4]))).toBe(0);
  });

  it("excludes `from` itself", () => {
    // Only index 2 (=from) is unanswered → nothing else to go to.
    expect(findNextUnanswered(4, 2, new Set([0, 1, 3]))).toBeNull();
  });

  it("returns null when everything is answered", () => {
    expect(findNextUnanswered(3, 0, new Set([0, 1, 2]))).toBeNull();
  });

  it("accepts a Map keyed by index (real exam answers shape)", () => {
    const answers = new Map<number, string>([
      [0, "opt A"],
      [2, "opt B"],
    ]);
    expect(findNextUnanswered(4, 0, answers)).toBe(1);
    expect(findNextUnanswered(4, 1, answers)).toBe(3);
  });

  it("handles a single-question exam", () => {
    expect(findNextUnanswered(1, 0, new Set())).toBeNull();
  });
});

// Migrated from pages/testing-flow-guards.test.ts in #70 — the guard moved to
// this module so components/ can use it without importing from pages/.
describe("canPostponeGuard", () => {
  it("true when unchecked and more questions remain", () => {
    expect(canPostponeGuard({ checked: false, hasMoreQuestions: true })).toBe(true);
  });

  it("false when checked (lock step)", () => {
    expect(canPostponeGuard({ checked: true, hasMoreQuestions: true })).toBe(false);
  });

  it("false when no more questions (last in queue)", () => {
    expect(canPostponeGuard({ checked: false, hasMoreQuestions: false })).toBe(false);
  });
});

describe("canPostponeAdaptive", () => {
  it("false without a replacement question to draw", () => {
    expect(
      canPostponeAdaptive({
        totalAnswered: 3,
        totalQuestions: 10,
        deferredCount: 0,
        hasReplacement: false,
      }),
    ).toBe(false);
  });

  it("false without slack (the deferred question would not fit back)", () => {
    expect(
      canPostponeAdaptive({
        totalAnswered: 9,
        totalQuestions: 10,
        deferredCount: 0,
        hasReplacement: true,
      }),
    ).toBe(false);
  });

  it("true with slack for the deferred question plus one to answer now", () => {
    expect(
      canPostponeAdaptive({
        totalAnswered: 3,
        totalQuestions: 10,
        deferredCount: 1,
        hasReplacement: true,
      }),
    ).toBe(true);
  });

  it("false once the already-deferred questions fill the remaining slots", () => {
    expect(
      canPostponeAdaptive({
        totalAnswered: 6,
        totalQuestions: 10,
        deferredCount: 3,
        hasReplacement: true,
      }),
    ).toBe(false);
  });
});

// Regression guard for #70: without this rule a postponed adaptive question
// stays in `questions`, so `fetchQuestion` treats it as already seen and it
// NEVER comes back — postponing would silently discard it (BR-03.1).
describe("shouldServeDeferred", () => {
  it("serve a diferida quando os slots restantes acabaram", () => {
    expect(
      shouldServeDeferred({
        totalAnswered: 9,
        totalQuestions: 10,
        deferredCount: 1,
        poolExhausted: false,
      }),
    ).toBe(true);
  });

  it("serve a diferida quando o pool acabou", () => {
    expect(
      shouldServeDeferred({
        totalAnswered: 2,
        totalQuestions: 10,
        deferredCount: 1,
        poolExhausted: true,
      }),
    ).toBe(true);
  });

  it("sorteia do pool enquanto ainda ha folga", () => {
    expect(
      shouldServeDeferred({
        totalAnswered: 2,
        totalQuestions: 10,
        deferredCount: 1,
        poolExhausted: false,
      }),
    ).toBe(false);
  });

  it("nada a servir sem diferidas", () => {
    expect(
      shouldServeDeferred({
        totalAnswered: 9,
        totalQuestions: 10,
        deferredCount: 0,
        poolExhausted: false,
      }),
    ).toBe(false);
    expect(
      shouldServeDeferred({
        totalAnswered: 9,
        totalQuestions: 10,
        deferredCount: 0,
        poolExhausted: true,
      }),
    ).toBe(false);
  });

  it("drena varias diferidas na cauda do simulado", () => {
    // 2 deferred, 2 slots left → the tail belongs to the deferred FIFO.
    expect(
      shouldServeDeferred({
        totalAnswered: 8,
        totalQuestions: 10,
        deferredCount: 2,
        poolExhausted: false,
      }),
    ).toBe(true);
  });
});

// ── Slice S2c: the FIFO and the ladder after a RESUME ───────────────────────
//
// A resumed simulado feeds these rules two rehydrated things: `deferredCount`
// from `modeState.deferredIds` (the FIFO's bodies come back from
// `questions.byIds`) and the persisted `AdaptiveState`. Both are ids/plain
// numbers by then, so the rules cannot tell a resumed run from a live one —
// which is exactly the property under test.
describe("deferidas rehidratadas (retomada)", () => {
  /** What `resumeAdaptiveFrom` handed back, as the board holds it. */
  const resumed = { deferredIds: ["a2", "a5"], totalAnswered: 8, totalQuestions: 10 };

  it("drena as 2 adiadas rehidratadas quando sobram exatamente 2 vagas", () => {
    expect(
      shouldServeDeferred({
        totalAnswered: resumed.totalAnswered,
        totalQuestions: resumed.totalQuestions,
        deferredCount: resumed.deferredIds.length,
        poolExhausted: false,
      }),
    ).toBe(true);
  });

  it("uma adiada que sumiu do catalogo deixa de ocupar vaga", () => {
    // `resumeAdaptiveFrom` drops an id that left the catalog from the FIFO: the
    // count that reaches this rule is the SURVIVORS', so the simulado still
    // draws a fresh question instead of holding a slot for a ghost.
    const survivors = resumed.deferredIds.filter((id) => id !== "a5");
    expect(
      shouldServeDeferred({
        totalAnswered: resumed.totalAnswered,
        totalQuestions: resumed.totalQuestions,
        deferredCount: survivors.length,
        poolExhausted: false,
      }),
    ).toBe(false);
  });

  it("canPostponeAdaptive apos a retomada conta as adiadas que voltaram", () => {
    // 10 - 5 - 2 = 3 ≥ 2: still room to postpone one more.
    expect(
      canPostponeAdaptive({
        totalAnswered: 5,
        totalQuestions: resumed.totalQuestions,
        deferredCount: resumed.deferredIds.length,
        hasReplacement: true,
      }),
    ).toBe(true);
    // 10 - 7 - 2 = 1 < 2: postponing now could shrink the simulado.
    expect(
      canPostponeAdaptive({
        totalAnswered: 7,
        totalQuestions: resumed.totalQuestions,
        deferredCount: resumed.deferredIds.length,
        hasReplacement: true,
      }),
    ).toBe(false);
  });
});

describe("nextAdaptiveStep", () => {
  const ladder = (over: Partial<AdaptiveState> = {}): AdaptiveState => ({
    currentDifficulty: "medium",
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    totalCorrect: 3,
    totalAnswered: 4,
    difficultyHistory: [],
    ...over,
  });

  it("termina quando o total contratado foi respondido", () => {
    expect(
      nextAdaptiveStep({
        adaptive: ladder({ totalAnswered: 10 }),
        totalQuestions: 10,
        deferredCount: 1,
        poolExhausted: false,
      }),
    ).toEqual({ kind: "finish" });
  });

  it("serve a FIFO na cauda antes de sortear", () => {
    expect(
      nextAdaptiveStep({
        adaptive: ladder({ totalAnswered: 9 }),
        totalQuestions: 10,
        deferredCount: 1,
        poolExhausted: false,
      }),
    ).toEqual({ kind: "deferred" });
  });

  it("sobe a escada a partir do estado PERSISTIDO, sem recomecar em medium", () => {
    // The resumed run carries the streak, so the very next question is drawn at
    // `hard` — a run that reset the ladder would draw `medium` here.
    const persisted = JSON.parse(
      JSON.stringify(ladder({ currentDifficulty: "medium", consecutiveCorrect: 2 })),
    ) as AdaptiveState;
    expect(
      nextAdaptiveStep({
        adaptive: persisted,
        totalQuestions: 10,
        deferredCount: 0,
        poolExhausted: false,
      }),
    ).toEqual({ kind: "draw", difficulty: "hard" });
  });

  it("desce a escada apos a sequencia de erros persistida", () => {
    expect(
      nextAdaptiveStep({
        adaptive: ladder({ currentDifficulty: "hard", consecutiveWrong: 2 }),
        totalQuestions: 10,
        deferredCount: 0,
        poolExhausted: false,
      }),
    ).toEqual({ kind: "draw", difficulty: "medium" });
  });

  it("honra um config alternativo", () => {
    expect(
      nextAdaptiveStep({
        adaptive: ladder({ currentDifficulty: "easy", consecutiveCorrect: 1 }),
        totalQuestions: 10,
        deferredCount: 0,
        poolExhausted: false,
        config: { ...DEFAULT_ADAPTIVE_CONFIG, stepUpAfter: 1 },
      }),
    ).toEqual({ kind: "draw", difficulty: "medium" });
  });
});
