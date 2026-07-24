// api/lib/allowance.test.ts
//
// Regression guards for api/lib/allowance.ts — Codex findings F1/F2/F3 (#52).
// Strategy: source-text assertions on the implementation file so each guard
// goes RED if the fix is reverted, without needing a live DB.
//
// F1: free-tier claim is atomic (claimFreeTierCounter uses conditional upsert,
//     not a separate SELECT then later UPDATE).
// F2: reverseFreeTierCounter exists and is exported (idempotent by last_job_id).
// F3: debitAllowance is never called from the free path; free path uses counter only.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "allowance.ts"), "utf-8");

// ── F1: Atomic free-tier claim ────────────────────────────────────────────────
describe("F1 — free-tier claim is atomic (no check-then-increment race)", () => {
  it("claimFreeTierCounter function exists", () => {
    expect(src).toContain("function claimFreeTierCounter");
  });

  it("uses INSERT … onConflictDoUpdate (not a plain SELECT)", () => {
    // The atomic path must use an upsert, not a read-then-write.
    expect(src).toContain("onConflictDoUpdate");
  });

  it("conditional guard uses setWhere predicate (not a CASE expression)", () => {
    // The real fix: setWhere makes the UPDATE a no-op when limit reached → 0 rows
    // returned → caller sees undefined → returns null (claim failed).
    // A CASE expression always returns a row even when exhausted — that is the bug.
    // This test goes RED against the old CASE-expression implementation.
    expect(src).toContain("setWhere");
  });

  it("setWhere references FREE_TIER_DAILY_LIMIT so the guard is data-driven", () => {
    // The predicate must be `count < FREE_TIER_DAILY_LIMIT`, not a hardcoded literal.
    const setWhereIdx = src.indexOf("setWhere");
    expect(setWhereIdx).toBeGreaterThan(-1);
    // FREE_TIER_DAILY_LIMIT must appear at or after the setWhere keyword
    const afterSetWhere = src.slice(setWhereIdx);
    expect(afterSetWhere).toContain("FREE_TIER_DAILY_LIMIT");
  });

  it("does NOT use CASE WHEN to conditionally guard count increment (that is the bug)", () => {
    // The CASE expression approach always fires the UPDATE and always returns a row,
    // so an exhausted claim (count=LIMIT) is indistinguishable from a successful one.
    // Presence of 'CASE WHEN' inside claimFreeTierCounter means the bug is still there.
    const fnStart = src.indexOf("async function claimFreeTierCounter");
    const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
    const body = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);
    expect(body).not.toContain("CASE WHEN");
  });

  it("claimFreeTierCounter returns null when result[0] is undefined (row-presence check)", () => {
    // The success/failure signal is row presence: undefined → limit reached → null.
    // The old code additionally checked count > LIMIT, which is wrong with limit=1.
    expect(src).toContain("if (claimed === undefined) return null;");
  });

  it("assertCoreEntitlement is removed (replaced by claimFreeTierCounter inside assertCoreAction)", () => {
    expect(src).not.toContain("export async function assertCoreEntitlement");
  });

  it("incrementFreeTierCounter is NOT exported (atomic claim replaces it)", () => {
    expect(src).not.toContain("export async function incrementFreeTierCounter");
  });

  it("assertCoreAction signature accepts jobId parameter", () => {
    expect(src).toContain("assertCoreAction(userId: string, jobId: string)");
  });
});

// ── F2: Idempotent reverse on relay failure ───────────────────────────────────
describe("F2 — reverseFreeTierCounter is exported and idempotent by last_job_id", () => {
  it("reverseFreeTierCounter is exported", () => {
    expect(src).toContain("export async function reverseFreeTierCounter");
  });

  it("reverse uses last_job_id equality in WHERE (idempotent by jobId)", () => {
    // The WHERE clause must match last_job_id = jobId so a second call is a no-op.
    expect(src).toContain("freeDailyCounter.lastJobId");
  });

  it("reverse uses GREATEST to prevent count going below 0", () => {
    expect(src).toContain("GREATEST");
  });

  it("reverse clears lastJobId to NULL (so second call finds no matching row)", () => {
    expect(src).toContain("lastJobId: null");
  });
});

// ── F3: Free path never writes allowance_ledger ───────────────────────────────
describe("F3 — debitAllowance is only for paid subscribers", () => {
  it("debitAllowance docstring states it must only be called for PAID users", () => {
    expect(src).toContain("MUST only be called for PAID users");
  });

  it("assertCoreAction does NOT call debitAllowance internally (caller gates on tier)", () => {
    // debitAllowance must NOT appear inside assertCoreAction's body.
    const fnStart = src.indexOf("export async function assertCoreAction");
    const fnEnd = src.indexOf("\nexport async function debitAllowance");
    const assertBody = src.slice(fnStart, fnEnd);
    expect(assertBody).not.toContain("debitAllowance(");
  });

  it("getAllowanceBalance comment states free-tier rows are excluded", () => {
    // The balance query must only sum paid rows; comment documents the invariant.
    expect(src).toContain("Free-tier consumption must never touch this table");
  });
});
