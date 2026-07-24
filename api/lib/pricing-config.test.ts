// api/lib/pricing-config.test.ts
//
// Regression guards for S5 pricing/config accessor (issue #53).
// Source-text assertions — no live DB needed.
//
// Guards:
//   P1 — requireRealCostPerUnit throws when real_cost_per_unit is null/missing
//   P2 — CONFIG_KEYS covers the required keys
//   P3 — upsertConfigRow uses ON CONFLICT DO UPDATE (admin-editable, no redeploy)
//   P4 — getAllConfigRows returns ordered rows (admin list)

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CONFIG_KEYS } from "./pricing-config";

const src = readFileSync(join(import.meta.dirname, "pricing-config.ts"), "utf-8");

describe("P1 — unset-real-cost guard", () => {
  it("requireRealCostPerUnit is exported", () => {
    expect(src).toContain("export async function requireRealCostPerUnit");
  });

  it("throws TRPCError when value is null", () => {
    expect(src).toContain("if (value === null)");
    expect(src).toContain("throw new TRPCError");
  });

  it("error code is INTERNAL_SERVER_ERROR", () => {
    expect(src).toContain('code: "INTERNAL_SERVER_ERROR"');
  });

  it("reads real_cost_per_unit key", () => {
    expect(src).toContain("CONFIG_KEYS.REAL_COST_PER_UNIT");
  });
});

describe("P2 — CONFIG_KEYS covers required keys (real module)", () => {
  it("has REAL_COST_PER_UNIT", () => {
    expect(CONFIG_KEYS.REAL_COST_PER_UNIT).toBe("real_cost_per_unit");
  });

  it("has MONTHLY_ALLOWANCE_UNITS", () => {
    expect(CONFIG_KEYS.MONTHLY_ALLOWANCE_UNITS).toBe("monthly_allowance_units");
  });

  it("has PLAN_PRICE_BRL", () => {
    expect(CONFIG_KEYS.PLAN_PRICE_BRL).toBe("plan_price_brl");
  });

  it("has ALLOWANCE_PACK_UNITS", () => {
    expect(CONFIG_KEYS.ALLOWANCE_PACK_UNITS).toBe("allowance_pack_units");
  });

  it("has CREDIT_PACK_SIZE", () => {
    expect(CONFIG_KEYS.CREDIT_PACK_SIZE).toBe("credit_pack_size");
  });

  it("has FREE_DAILY_LIMIT", () => {
    expect(CONFIG_KEYS.FREE_DAILY_LIMIT).toBe("free_daily_limit");
  });
});

describe("P3 — upsertConfigRow uses ON CONFLICT DO UPDATE", () => {
  it("exported", () => {
    expect(src).toContain("export async function upsertConfigRow");
  });

  it("uses onConflictDoUpdate (no redeploy required)", () => {
    expect(src).toContain("onConflictDoUpdate");
  });

  it("target is pricingConfig.key (primary key)", () => {
    expect(src).toContain("target: pricingConfig.key");
  });
});

describe("P4 — getAllConfigRows returns ordered list", () => {
  it("exported", () => {
    expect(src).toContain("export async function getAllConfigRows");
  });

  it("orders by pricingConfig.key", () => {
    expect(src).toContain("orderBy(pricingConfig.key)");
  });
});
