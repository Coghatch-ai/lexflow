// api/db/scope.test.ts
//
// Regression guard: monetization schema foundation (issue #51).
//
// Strategy: read source files as text and assert structural invariants that
// would silently break the spend engine (#52) if violated. No DB connection
// needed — static analysis only (matches the project's plain-vitest pattern).

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const scopeSrc = readFileSync(join(import.meta.dirname, "scope.ts"), "utf-8");
const schemaSrc = readFileSync(join(import.meta.dirname, "../../drizzle/schema-ai.ts"), "utf-8");

// ── Dead code removal (S1) ───────────────────────────────────────────────────

describe("dead code removal — issue #51", () => {
  it("ai_usage_daily is not in TABLE_SCOPE", () => {
    expect(scopeSrc).not.toContain("ai_usage_daily");
  });

  it("aiUsageDaily table is not exported from schema-ai.ts", () => {
    // Check for the export declaration and pgTable call — not just any comment reference.
    expect(schemaSrc).not.toContain("export const aiUsageDaily");
    expect(schemaSrc).not.toContain('pgTable(\n  "ai_usage_daily"');
    expect(schemaSrc).not.toContain('pgTable("ai_usage_daily"');
  });
});

// ── New tables exported from schema-ai.ts (S1 + S2) ─────────────────────────

describe("new monetization tables present in schema-ai.ts", () => {
  it("subscriptions table exported", () => {
    expect(schemaSrc).toContain("export const subscriptions");
    expect(schemaSrc).toContain('"subscriptions"');
  });

  it("unified credit engine tables exported (credit_balances + credit_charges)", () => {
    expect(schemaSrc).toContain("export const creditBalances");
    expect(schemaSrc).toContain('"credit_balances"');
    expect(schemaSrc).toContain("export const creditCharges");
    expect(schemaSrc).toContain('"credit_charges"');
  });

  it("D4 no-legacy: the old allowance rail + free-tier counter tables are GONE", () => {
    expect(schemaSrc).not.toContain("export const allowanceLedger");
    expect(schemaSrc).not.toContain("export const freeDailyCounter");
  });
});

// ── TABLE_SCOPE entries present ──────────────────────────────────────────────

describe("TABLE_SCOPE entries for user-owned monetization tables", () => {
  it("subscriptions is user-scoped", () => {
    expect(scopeSrc).toContain('subscriptions: { type: "user" }');
  });

  it("credit_balances + credit_charges are user-scoped", () => {
    expect(scopeSrc).toContain('credit_balances: { type: "user" }');
    expect(scopeSrc).toContain('credit_charges: { type: "user" }');
  });

  it("D4 no-legacy: the removed tables have NO TABLE_SCOPE entry", () => {
    expect(scopeSrc).not.toContain("allowance_ledger:");
    expect(scopeSrc).not.toContain("free_daily_counter:");
  });
});
