import { describe, expect, it } from "vitest";
import { clampScore, isProvaPass, PASS_THRESHOLD, sumScores } from "./discursive-attempt";

describe("clampScore", () => {
  it("bounds into [0, maxPoints] and rounds to 2 decimals", () => {
    expect(clampScore(-1, 1.25)).toBe(0);
    expect(clampScore(2, 1.25)).toBe(1.25);
    expect(clampScore(0.6666, 1.25)).toBe(0.67);
  });
});

describe("sumScores", () => {
  it("treats null as 0 and rounds the total", () => {
    expect(sumScores([5, 1.25, null, 1.1, 0.65])).toBe(8);
    expect(sumScores([])).toBe(0);
  });
});

describe("isProvaPass", () => {
  it("passes at or above the threshold", () => {
    expect(isProvaPass(PASS_THRESHOLD)).toBe(true);
    expect(isProvaPass(6.01)).toBe(true);
    expect(isProvaPass(5.99)).toBe(false);
  });
});
