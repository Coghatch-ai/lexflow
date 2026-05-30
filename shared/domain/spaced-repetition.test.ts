import { describe, expect, it } from "vitest";
import { nextReviewIntervalDays } from "./spaced-repetition";

describe("nextReviewIntervalDays", () => {
  it("advances to the next interval on correct", () => {
    expect(nextReviewIntervalDays(1, true)).toBe(3);
    expect(nextReviewIntervalDays(7, true)).toBe(14);
  });
  it("resets to the first interval on wrong", () => {
    expect(nextReviewIntervalDays(14, false)).toBe(1);
  });
  it("caps at the last interval", () => {
    expect(nextReviewIntervalDays(30, true)).toBe(30);
  });
});
