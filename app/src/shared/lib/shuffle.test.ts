import { describe, expect, it } from "vitest";
import { shuffle } from "./shuffle";

// Deterministic LCG so two runs with the same seed produce the same sequence.
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("shuffle", () => {
  it("produces the exact permutation implied by the injected rng", () => {
    // rng() === 0 makes j = 0 at every step:
    // [a,b,c,d] -> swap(3,0) dbca -> swap(2,0) cbda -> swap(1,0) bcda
    expect(shuffle(["a", "b", "c", "d"], () => 0)).toEqual(["b", "c", "d", "a"]);
  });

  it("is deterministic for the same rng seed", () => {
    const input = ["a", "b", "c", "d", "e"];
    expect(shuffle(input, lcg(42))).toEqual(shuffle(input, lcg(42)));
  });

  it("returns a permutation (same length, same multiset)", () => {
    for (const input of [
      ["w", "x", "y", "z"],
      ["1", "2", "3", "4", "5"],
    ]) {
      const result = shuffle(input, lcg(7));
      expect(result).toHaveLength(input.length);
      expect([...result].sort()).toEqual([...input].sort());
    }
  });

  it("does not mutate the input and returns a new reference", () => {
    const input = ["a", "b", "c", "d"];
    const snapshot = [...input];
    const result = shuffle(input, lcg(99));
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["only"])).toEqual(["only"]);
  });

  it("keeps indices in range at the rng upper bound", () => {
    const result = shuffle(["a", "b", "c", "d", "e"], () => 0.999999);
    expect(result).toHaveLength(5);
    expect(result).not.toContain(undefined);
  });
});
