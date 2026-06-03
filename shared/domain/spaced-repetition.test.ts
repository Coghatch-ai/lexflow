import { describe, expect, it } from "vitest";
import {
  nextReviewIntervalDays,
  sm2Update,
  DEFAULT_SM2_STATE,
  DEFAULT_SM2_CONFIG,
} from "./spaced-repetition";

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

describe("sm2Update", () => {
  it("1st correct answer → interval = initialInterval, repetitions = 1, EF increases", () => {
    const next = sm2Update(DEFAULT_SM2_STATE, true, DEFAULT_SM2_CONFIG);
    expect(next.repetitions).toBe(1);
    expect(next.interval).toBe(DEFAULT_SM2_CONFIG.initialInterval);
    expect(next.easeFactor).toBeGreaterThan(DEFAULT_SM2_STATE.easeFactor);
  });

  it("2nd correct answer → interval = secondInterval, repetitions = 2", () => {
    const after1 = sm2Update(DEFAULT_SM2_STATE, true, DEFAULT_SM2_CONFIG);
    const after2 = sm2Update(after1, true, DEFAULT_SM2_CONFIG);
    expect(after2.repetitions).toBe(2);
    expect(after2.interval).toBe(DEFAULT_SM2_CONFIG.secondInterval);
  });

  it("3rd+ correct answer → interval grows by EF", () => {
    let state = DEFAULT_SM2_STATE;
    for (let i = 0; i < 3; i++) state = sm2Update(state, true, DEFAULT_SM2_CONFIG);
    expect(state.repetitions).toBe(3);
    expect(state.interval).toBeGreaterThan(DEFAULT_SM2_CONFIG.secondInterval);
  });

  it("wrong answer resets repetitions and interval, penalises EF", () => {
    const afterCorrect = sm2Update(DEFAULT_SM2_STATE, true, DEFAULT_SM2_CONFIG);
    const afterWrong = sm2Update(afterCorrect, false, DEFAULT_SM2_CONFIG);
    expect(afterWrong.repetitions).toBe(0);
    expect(afterWrong.interval).toBe(DEFAULT_SM2_CONFIG.initialInterval);
    expect(afterWrong.easeFactor).toBeLessThan(afterCorrect.easeFactor);
  });

  it("EF never drops below minEaseFactor", () => {
    let state = DEFAULT_SM2_STATE;
    for (let i = 0; i < 20; i++) state = sm2Update(state, false, DEFAULT_SM2_CONFIG);
    expect(state.easeFactor).toBeGreaterThanOrEqual(DEFAULT_SM2_CONFIG.minEaseFactor);
  });
});
