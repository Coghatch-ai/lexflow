import { describe, expect, it } from "vitest";
import {
  IDLE_SWIPE,
  NO_ELIMINATIONS,
  type SwipeLatch,
  clearForQuestion,
  consumeClick,
  eliminatedFor,
  eliminationDropsAnswer,
  endSwipe,
  isEliminated,
  isEliminationSwipe,
  optionRowKey,
  startSwipe,
  toggleElimination,
} from "./eliminations";

describe("toggleElimination", () => {
  it("eliminates an option and toggles it back", () => {
    const eliminated = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    expect(isEliminated(eliminated, "q1", "B")).toBe(true);

    const restored = toggleElimination(eliminated, "q1", "B");
    expect(isEliminated(restored, "q1", "B")).toBe(false);
  });

  it("keeps eliminations scoped to their question", () => {
    const state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    expect(isEliminated(state, "q2", "B")).toBe(false);
    expect(eliminatedFor(state, "q2")).toEqual([]);
  });

  it("accumulates several options for the same question", () => {
    let state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    state = toggleElimination(state, "q1", "D");
    expect(eliminatedFor(state, "q1")).toEqual(["B", "D"]);
    expect(isEliminated(state, "q1", "D")).toBe(true);
  });

  it("restoring one option leaves the other eliminated", () => {
    let state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    state = toggleElimination(state, "q1", "D");
    state = toggleElimination(state, "q1", "B");
    expect(eliminatedFor(state, "q1")).toEqual(["D"]);
    expect(isEliminated(state, "q1", "B")).toBe(false);
  });

  it("does not mutate the input state and returns a new reference", () => {
    const before = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    const after = toggleElimination(before, "q1", "D");
    expect(after).not.toBe(before);
    expect(eliminatedFor(before, "q1")).toEqual(["B"]);
    expect(NO_ELIMINATIONS.size).toBe(0);
  });

  it("drops the question key entirely once its last option is restored", () => {
    const state = toggleElimination(toggleElimination(NO_ELIMINATIONS, "q1", "B"), "q1", "B");
    expect(state.has("q1")).toBe(false);
  });
});

describe("eliminatedFor", () => {
  it("returns the same empty reference for a question with no eliminations", () => {
    const state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    expect(eliminatedFor(state, "q2")).toBe(eliminatedFor(state, "q3"));
    expect(eliminatedFor(NO_ELIMINATIONS, "q1")).toBe(eliminatedFor(state, "q2"));
  });

  it("returns the eliminated options of the question", () => {
    const state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    expect(eliminatedFor(state, "q1")).toEqual(["B"]);
  });
});

describe("clearForQuestion", () => {
  it("clears only the target question", () => {
    let state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    state = toggleElimination(state, "q2", "C");
    const cleared = clearForQuestion(state, "q1");
    expect(eliminatedFor(cleared, "q1")).toEqual([]);
    expect(eliminatedFor(cleared, "q2")).toEqual(["C"]);
  });

  it("returns the same reference when the question has no eliminations", () => {
    const state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    expect(clearForQuestion(state, "q2")).toBe(state);
    expect(clearForQuestion(NO_ELIMINATIONS, "q1")).toBe(NO_ELIMINATIONS);
  });

  it("does not mutate the input state", () => {
    const state = toggleElimination(NO_ELIMINATIONS, "q1", "B");
    clearForQuestion(state, "q1");
    expect(eliminatedFor(state, "q1")).toEqual(["B"]);
  });
});

describe("isEliminationSwipe", () => {
  it("accepts a horizontal drag past the threshold, in either direction", () => {
    expect(isEliminationSwipe(-70, 10)).toBe(true);
    expect(isEliminationSwipe(70, 10)).toBe(true);
    expect(isEliminationSwipe(60, 0)).toBe(true);
  });

  it("rejects a drag shorter than the threshold", () => {
    expect(isEliminationSwipe(59, 0)).toBe(false);
    expect(isEliminationSwipe(0, 0)).toBe(false);
  });

  it("rejects a vertical-dominant drag so page scroll is never hijacked", () => {
    expect(isEliminationSwipe(70, 90)).toBe(false);
    expect(isEliminationSwipe(70, -90)).toBe(false);
    expect(isEliminationSwipe(70, 70)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isEliminationSwipe(30, 0, 20)).toBe(true);
    expect(isEliminationSwipe(30, 0, 40)).toBe(false);
  });
});

describe("NO_ELIMINATIONS", () => {
  it("is a frozen empty state", () => {
    expect(Object.isFrozen(NO_ELIMINATIONS)).toBe(true);
    expect(NO_ELIMINATIONS.size).toBe(0);
  });
});

// The row's touch latch. These replace what used to be untestable `useRef`
// bookkeeping inside QuestionCard's OptionRow.
describe("swipe latch", () => {
  /** Drag the row from (0,0) to (dx,dy), as the card's touch handlers do. */
  function drag(dx: number, dy: number): { latch: SwipeLatch; crossOut: boolean } {
    return endSwipe(startSwipe(0, 0), dx, dy);
  }

  it("starts idle: a plain click selects", () => {
    expect(IDLE_SWIPE.origin).toBeNull();
    expect(consumeClick(IDLE_SWIPE).selects).toBe(true);
  });

  it("a cross-out swipe toggles the option and swallows its synthetic click", () => {
    const swiped = drag(-70, 10);
    expect(swiped.crossOut).toBe(true);
    expect(swiped.latch.swallowClick).toBe(true);

    const clicked = consumeClick(swiped.latch);
    expect(clicked.selects).toBe(false);
    // Only the FIRST click is swallowed.
    expect(consumeClick(clicked.latch).selects).toBe(true);
  });

  it("a short or vertical drag neither crosses out nor swallows the tap", () => {
    expect(drag(12, 4).crossOut).toBe(false);
    expect(consumeClick(drag(12, 4).latch).selects).toBe(true);
    expect(drag(70, 90).crossOut).toBe(false);
    expect(consumeClick(drag(70, 90).latch).selects).toBe(true);
  });

  it("a swipe whose click never arrives does not eat the next tap", () => {
    // Chrome/Android cancels the tap past touch slop, so no click follows the
    // cross-out swipe — the latch must not survive into the next gesture.
    const swiped = drag(-70, 0);
    expect(swiped.latch.swallowClick).toBe(true);

    const nextTap = endSwipe(startSwipe(20, 20), 22, 21);
    expect(nextTap.crossOut).toBe(false);
    expect(consumeClick(nextTap.latch).selects).toBe(true);
  });

  it("a new gesture on a reused row starts clean even after an unconsumed swipe", () => {
    // Row instance kept by React across questions (or after "Responder depois").
    const stale = drag(80, 5).latch;
    expect(consumeClick(startSwipe(5, 5)).selects).toBe(true);
    expect(startSwipe(5, 5).swallowClick).toBe(false);
    expect(stale.swallowClick).toBe(true);
  });

  it("ignores a touch end with no touch start", () => {
    const ended = endSwipe(IDLE_SWIPE, 999, 0);
    expect(ended.crossOut).toBe(false);
    expect(ended.latch).toBe(IDLE_SWIPE);
  });

  it("never mutates the latch it is given", () => {
    const started = startSwipe(0, 0);
    endSwipe(started, -70, 0);
    expect(started.origin).toEqual({ x: 0, y: 0 });

    const armed = drag(-70, 0).latch;
    consumeClick(armed);
    expect(armed.swallowClick).toBe(true);
  });

  it("honours the swipe threshold it shares with isEliminationSwipe", () => {
    expect(endSwipe(startSwipe(0, 0), 59, 0).crossOut).toBe(false);
    expect(endSwipe(startSwipe(0, 0), 60, 0).crossOut).toBe(true);
    expect(endSwipe(startSwipe(0, 0), 30, 0, 20).crossOut).toBe(true);
  });
});

describe("eliminationDropsAnswer", () => {
  it("drops the answer when the crossed-out option is the chosen one", () => {
    expect(eliminationDropsAnswer("B", "B")).toBe(true);
  });

  it("keeps the answer when another option is crossed out", () => {
    expect(eliminationDropsAnswer("B", "D")).toBe(false);
  });

  it("is false with no answer selected (empty string never matches)", () => {
    expect(eliminationDropsAnswer("", "B")).toBe(false);
    // Guards the degenerate case: an empty option text must not "drop" a
    // non-answer just because two empty strings are equal.
    expect(eliminationDropsAnswer("", "")).toBe(false);
  });
});

// Regression guard for the leaking row latch (#85 review): the mobile rows were
// keyed by index+option text alone, so two questions offering the SAME option
// text at the SAME position reused one React element — and with it the row's
// swipe latch, which then swallowed the first tap on the NEXT question.
describe("optionRowKey", () => {
  const OPTIONS = ["Verdadeiro", "Falso"];

  // Stand-in for React reconciliation: a row instance (its latch) survives a
  // re-render exactly when its key is unchanged; a new key mounts a fresh row.
  function render(
    mounted: ReadonlyMap<string, SwipeLatch>,
    questionId: string,
    options: readonly string[],
  ): Map<string, SwipeLatch> {
    const next = new Map<string, SwipeLatch>();
    options.forEach((option, index) => {
      const key = optionRowKey(questionId, index, option);
      next.set(key, mounted.get(key) ?? IDLE_SWIPE);
    });
    return next;
  }

  function latchAt(
    rows: ReadonlyMap<string, SwipeLatch>,
    questionId: string,
    index: number,
    option: string,
  ): SwipeLatch {
    return rows.get(optionRowKey(questionId, index, option)) ?? IDLE_SWIPE;
  }

  it("gives every question its own row identity for the same option text", () => {
    expect(optionRowKey("q1", 0, "Verdadeiro")).not.toBe(optionRowKey("q2", 0, "Verdadeiro"));
  });

  it("is stable for the same question, index and option", () => {
    expect(optionRowKey("q1", 0, "Verdadeiro")).toBe(optionRowKey("q1", 0, "Verdadeiro"));
    expect(optionRowKey("q1", 0, "Verdadeiro")).not.toBe(optionRowKey("q1", 1, "Verdadeiro"));
  });

  it("does not carry a row's swipe latch into the next question", () => {
    // q1: a real cross-out swipe on row 0 arms the click swallow.
    let rows = render(new Map<string, SwipeLatch>(), "q1", OPTIONS);
    const swiped = endSwipe(startSwipe(200, 100), 100, 105);
    expect(swiped.crossOut).toBe(true);
    rows = new Map(rows).set(optionRowKey("q1", 0, OPTIONS[0] ?? ""), swiped.latch);
    expect(latchAt(rows, "q1", 0, OPTIONS[0] ?? "").swallowClick).toBe(true);

    // q2 offers the SAME texts at the SAME positions: its row 0 must be fresh,
    // or the student's first tap on it is silently swallowed.
    const nextRows = render(rows, "q2", OPTIONS);
    const row0 = latchAt(nextRows, "q2", 0, OPTIONS[0] ?? "");
    expect(row0.swallowClick).toBe(false);
    expect(consumeClick(row0).selects).toBe(true);
  });
});
