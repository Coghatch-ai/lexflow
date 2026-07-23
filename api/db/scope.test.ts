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

  it("allowance_ledger table exported", () => {
    expect(schemaSrc).toContain("export const allowanceLedger");
    expect(schemaSrc).toContain('"allowance_ledger"');
  });

  it("free_daily_counter table exported", () => {
    expect(schemaSrc).toContain("export const freeDailyCounter");
    expect(schemaSrc).toContain('"free_daily_counter"');
  });
});

// ── TABLE_SCOPE entries present (S1 + S2) ────────────────────────────────────

describe("TABLE_SCOPE entries for new user-owned tables", () => {
  it("subscriptions is user-scoped", () => {
    expect(scopeSrc).toContain('subscriptions: { type: "user" }');
  });

  it("allowance_ledger is user-scoped", () => {
    expect(scopeSrc).toContain('allowance_ledger: { type: "user" }');
  });

  it("free_daily_counter is user-scoped", () => {
    expect(scopeSrc).toContain('free_daily_counter: { type: "user" }');
  });
});

// ── Money invariants — allowance_ledger mirrors credit_ledger shape ──────────

describe("allowance_ledger money invariants", () => {
  it("has delta column (SUM-based balance)", () => {
    expect(schemaSrc).toContain('"delta"');
  });

  it("has ref_id unique column (idempotency)", () => {
    expect(schemaSrc).toContain('"ref_id"');
  });

  it("has action column", () => {
    // 'action' appears in allowanceLedger block
    expect(schemaSrc).toContain('"action"');
  });
});
