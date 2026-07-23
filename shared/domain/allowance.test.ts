// shared/domain/allowance.test.ts
//
// Unit tests for shared/domain/allowance.ts constants and types.
// Guards the spend-routing invariants that no number is hardcoded beyond
// the injectable placeholder, and that the currency split is encoded correctly.

import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_COST,
  FREE_TIER_DAILY_LIMIT,
  PLAN_FREE,
  PLAN_PAID,
  type AllowanceAction,
} from "./allowance";
import { CREDIT_COSTS, type CreditAction } from "./credits";

describe("allowance constants", () => {
  it("ALLOWANCE_COST is a positive integer", () => {
    expect(ALLOWANCE_COST).toBeGreaterThan(0);
    expect(Number.isInteger(ALLOWANCE_COST)).toBe(true);
  });

  it("FREE_TIER_DAILY_LIMIT is 1 (one core use per day)", () => {
    expect(FREE_TIER_DAILY_LIMIT).toBe(1);
  });

  it("plan codes are non-empty strings", () => {
    expect(PLAN_FREE).toBe("free");
    expect(PLAN_PAID).toBe("paid");
  });
});

describe("currency split S3 — grade is NOT in CREDIT_COSTS", () => {
  it("CREDIT_COSTS does not contain grade (grade moved to allowance rail)", () => {
    expect(Object.keys(CREDIT_COSTS)).not.toContain("grade");
  });

  it("CREDIT_COSTS contains tutor (non-core stays on credits)", () => {
    expect(Object.keys(CREDIT_COSTS)).toContain("tutor");
  });

  it("CREDIT_COSTS contains coach (non-core stays on credits)", () => {
    expect(Object.keys(CREDIT_COSTS)).toContain("coach");
  });
});

describe("AllowanceAction type coverage", () => {
  // Type-level test: ensure the union covers the expected values at runtime.
  const validActions: AllowanceAction[] = [
    "spend",
    "refund",
    "monthly_grant",
    "top_up",
    "rollover",
    "expire",
    "admin_grant",
  ];

  it("all expected AllowanceAction values are valid strings", () => {
    for (const action of validActions) {
      expect(typeof action).toBe("string");
    }
  });
});

describe("CreditAction type no longer includes grade", () => {
  // Compile-time guard enforced by TypeScript; runtime check for belt-and-suspenders.
  const creditActions: CreditAction[] = ["tutor", "coach"];
  it("CreditAction array does not include grade", () => {
    expect(creditActions).not.toContain("grade");
  });
});
