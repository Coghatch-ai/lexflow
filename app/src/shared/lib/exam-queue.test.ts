import { describe, expect, it } from "vitest";
import { findNextUnanswered, moveToEnd } from "./exam-queue";

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
