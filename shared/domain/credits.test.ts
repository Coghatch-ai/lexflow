import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, isValidCouponCode, normalizeCouponCode } from "./credits";

describe("coupon code validation", () => {
  it("accepts the XXXX-XXXX format from the safe alphabet", () => {
    expect(isValidCouponCode("ABCD-2345")).toBe(true);
    expect(isValidCouponCode("  abcd-2345  ")).toBe(true); // normalized
  });

  it("rejects lookalike characters and wrong shapes", () => {
    expect(isValidCouponCode("ABCI-2345")).toBe(false); // I excluded
    expect(isValidCouponCode("ABCO-2345")).toBe(false); // O excluded
    expect(isValidCouponCode("ABC0-2345")).toBe(false); // 0 excluded
    expect(isValidCouponCode("ABC1-2345")).toBe(false); // 1 excluded
    expect(isValidCouponCode("ABCD2345")).toBe(false); // missing dash
    expect(isValidCouponCode("ABCD-234")).toBe(false); // short
    expect(isValidCouponCode("")).toBe(false);
  });

  it("normalizes to uppercase trimmed", () => {
    expect(normalizeCouponCode(" abcd-2345 ")).toBe("ABCD-2345");
  });
});

describe("credit costs", () => {
  it("every action has a positive integer cost", () => {
    for (const cost of Object.values(CREDIT_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });
});
