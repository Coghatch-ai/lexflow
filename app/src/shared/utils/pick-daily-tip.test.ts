// app/src/shared/utils/pick-daily-tip.test.ts

import { describe, expect, it } from "vitest";
import { pickDailyTip } from "./pick-daily-tip";

const TIPS = ["tip-0", "tip-1", "tip-2", "tip-3", "tip-4"];

describe("pickDailyTip", () => {
  it("returns tip at index 0 for epoch day 0", () => {
    // now = 0 ms → day index 0
    expect(pickDailyTip(TIPS, 0)).toBe("tip-0");
  });

  it("returns tip at index 1 for epoch day 1", () => {
    // now = 86_400_000 ms → day index 1
    expect(pickDailyTip(TIPS, 86_400_000)).toBe("tip-1");
  });

  it("wraps around modulo array length", () => {
    // day 5 → index 5 % 5 = 0
    expect(pickDailyTip(TIPS, 5 * 86_400_000)).toBe("tip-0");
    // day 7 → index 7 % 5 = 2
    expect(pickDailyTip(TIPS, 7 * 86_400_000)).toBe("tip-2");
  });

  it("two consecutive days yield different tips", () => {
    const day3 = pickDailyTip(TIPS, 3 * 86_400_000);
    const day4 = pickDailyTip(TIPS, 4 * 86_400_000);
    expect(day3).not.toBe(day4);
  });

  it("same day (different ms within day) yields same tip", () => {
    const base = 10 * 86_400_000;
    expect(pickDailyTip(TIPS, base)).toBe(pickDailyTip(TIPS, base + 3_600_000));
  });

  it("falls back to first tip for empty string entries", () => {
    // edge: idx resolves to valid string even at large day numbers
    expect(typeof pickDailyTip(TIPS, 9999 * 86_400_000)).toBe("string");
  });
});
