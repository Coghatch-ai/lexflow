import { describe, expect, it } from "vitest";
import { accuracyPct, goalProgressPct } from "./scoring";

describe("accuracyPct", () => {
  it("rounds correct/total to a percent", () => {
    expect(accuracyPct(3, 5)).toBe(60);
    expect(accuracyPct(1, 3)).toBe(33);
  });
  it("returns 0 when nothing answered", () => {
    expect(accuracyPct(0, 0)).toBe(0);
  });
});

describe("goalProgressPct", () => {
  it("computes partial progress", () => {
    expect(goalProgressPct(40, 80)).toBe(50);
  });
  it("caps at 100", () => {
    expect(goalProgressPct(90, 80)).toBe(100);
  });
  it("returns 0 when target is 0", () => {
    expect(goalProgressPct(50, 0)).toBe(0);
  });
});
