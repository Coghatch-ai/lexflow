// api/lib/ledger-debit.test.ts
//
// Regression guards for api/lib/ledger-debit.ts — issue #55 atomicDebit helper.
// Source-text assertions — no live DB needed.
//
// HONEST LIMIT: true concurrency tests (two simultaneous debits for same user+rail
// at balance==cost, exactly one succeeds) require a live Postgres instance and should
// run pre-deploy. These source-text guards verify the advisory lock + atomic predicate
// are present so a revert goes RED without a running DB.
//
// Guards:
//   D1 — pg_advisory_xact_lock taken BEFORE balance guard (debit serialization)
//   D2 — guarded INSERT-SELECT contains the balance WHERE predicate (coalesce + >= cost)
//   D3 — ON CONFLICT DO NOTHING present in same statement (idempotent replay)
//   D4 — replay detection: second SELECT on ref_id to distinguish replay vs. insufficient
//   D5 — atomicDebitAllowance exported; uses allowanceLedger
//   D6 — atomicDebitCredits exported; uses creditLedger
//   D7 — both rails import from this file (single debit path, no drift)
//   D8 — lock runs inside db.transaction (lock + guard + insert in same tx)

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "ledger-debit.ts"), "utf-8");
const allowanceSrc = readFileSync(join(import.meta.dirname, "allowance.ts"), "utf-8");
const creditsSrc = readFileSync(join(import.meta.dirname, "credits.ts"), "utf-8");

// ── D1: Advisory lock taken before balance guard ──────────────────────────────
describe("D1 — pg_advisory_xact_lock serializes debits before balance check", () => {
  it("contains pg_advisory_xact_lock call", () => {
    // Lock MUST be present — without it two concurrent debits at balance==cost
    // both read the pre-debit SUM under READ COMMITTED and both succeed (overspend).
    expect(src).toContain("pg_advisory_xact_lock");
  });

  it("advisory lock appears before the INSERT-SELECT in source order", () => {
    // Lock must be taken BEFORE reading the balance, not after.
    const lockPos = src.indexOf("pg_advisory_xact_lock");
    const insertPos = src.indexOf("INSERT INTO ${p.table}");
    expect(lockPos).toBeGreaterThan(-1);
    expect(insertPos).toBeGreaterThan(-1);
    expect(lockPos).toBeLessThan(insertPos);
  });

  it("lock key is derived from userId and lockNamespace (per-user per-rail)", () => {
    // Lock key must encode both user and rail so allowance+credit rails for same
    // user don't unnecessarily block each other.
    expect(src).toContain("hashLockKey");
    expect(src).toContain("p.userId");
    expect(src).toContain("p.lockNamespace");
  });

  it("atomicDebitAllowance passes lockNamespace: allowance", () => {
    expect(src).toContain('lockNamespace: "allowance"');
  });

  it("atomicDebitCredits passes lockNamespace: credit", () => {
    expect(src).toContain('lockNamespace: "credit"');
  });
});

// ── D2: Balance WHERE predicate (defense-in-depth) ────────────────────────────
describe("D2 — guarded INSERT-SELECT has balance WHERE predicate", () => {
  it("contains coalesce(sum(delta)... in the WHERE guard", () => {
    // Defense-in-depth: even after the advisory lock, the guard rejects a debit
    // when balance < cost (catches stale callers, adds a second safety net).
    expect(src).toContain("coalesce(sum(delta)");
  });

  it("WHERE guard uses >= cost comparison (not < which would invert the logic)", () => {
    expect(src).toContain(">= ${p.cost}");
  });

  it("balance check is a subquery inside the INSERT (single statement)", () => {
    expect(src).toContain("INSERT INTO ${p.table}");
    expect(src).toContain("SELECT");
    expect(src).toMatch(/WHERE \(\s*SELECT coalesce\(sum\(delta\)/);
  });
});

// ── D3: ON CONFLICT DO NOTHING (idempotent replay) ───────────────────────────
describe("D3 — ON CONFLICT DO NOTHING absorbs ref_id replays", () => {
  it("contains ON CONFLICT (ref_id) DO NOTHING in the guarded insert", () => {
    expect(src).toContain("ON CONFLICT (ref_id) DO NOTHING");
  });

  it("RETURNING id present so row-count distinguishes insert vs. conflict", () => {
    expect(src).toContain("RETURNING id");
  });
});

// ── D4: Replay vs. insufficient balance distinction ───────────────────────────
describe("D4 — replay detection distinguishes 0-rows cases", () => {
  it("on 0 rows: queries ref_id existence to detect replay", () => {
    // When the INSERT returns 0 rows there are two causes:
    //   (a) replay — ref_id already in table (ON CONFLICT) → success
    //   (b) balance guard fired (balance < cost) → FORBIDDEN
    // A second SELECT on ref_id distinguishes them.
    expect(src).toContain("SELECT id FROM ${p.table} WHERE ref_id = ${p.refId}");
  });

  it("replay returns false (not an error)", () => {
    // Idempotent replay must succeed silently, not throw.
    expect(src).toContain("// Replay — idempotent success.");
    expect(src).toContain("return false;");
  });

  it("throws FORBIDDEN when balance guard fires (not replay)", () => {
    expect(src).toContain('code: "FORBIDDEN"');
    expect(src).toContain("p.forbiddenMessage");
  });
});

// ── D5: Refund/grant NOT routed through this helper ───────────────────────────
describe("D5 — refund and grant paths bypass the balance guard", () => {
  it("docstring explicitly excludes refund and grant paths", () => {
    expect(src).toContain("Refund and grant paths are NOT routed through this helper");
  });

  it("free-tier path exclusion documented", () => {
    expect(src).toContain("Free-tier path uses claimFreeTierCounter");
  });
});

// ── D6: atomicDebitAllowance exported ────────────────────────────────────────
describe("D6 — atomicDebitAllowance exported and uses allowanceLedger", () => {
  it("atomicDebitAllowance is exported", () => {
    expect(src).toContain("export async function atomicDebitAllowance");
  });

  it("uses allowanceLedger table", () => {
    expect(src).toContain("table: allowanceLedger");
  });

  it("uses ALLOWANCE_COST for cost and delta", () => {
    expect(src).toContain("cost: ALLOWANCE_COST");
    expect(src).toContain("delta: -ALLOWANCE_COST");
  });
});

// ── D7: atomicDebitCredits exported ──────────────────────────────────────────
describe("D7 — atomicDebitCredits exported and uses creditLedger", () => {
  it("atomicDebitCredits is exported", () => {
    expect(src).toContain("export async function atomicDebitCredits");
  });

  it("uses creditLedger table", () => {
    expect(src).toContain("table: creditLedger");
  });

  it("uses CREDIT_COSTS[action] for cost (no hardcoded number)", () => {
    expect(src).toContain("const cost = CREDIT_COSTS[action]");
    expect(src).toContain("cost,");
    expect(src).toContain("delta: -cost");
  });
});

// ── D8: Both rails import from ledger-debit (single debit path) ───────────────
describe("D8 — both allowance and credit rails import from ledger-debit", () => {
  it("allowance.ts imports atomicDebitAllowance from ledger-debit", () => {
    expect(allowanceSrc).toContain('from "./ledger-debit"');
    expect(allowanceSrc).toContain("atomicDebitAllowance");
  });

  it("credits.ts imports atomicDebitCredits from ledger-debit", () => {
    expect(creditsSrc).toContain('from "./ledger-debit"');
    expect(creditsSrc).toContain("atomicDebitCredits");
  });

  it("credits.ts debitCredits delegates to atomicDebitCredits (no unconditional insert)", () => {
    // The old two-step (assertCredits → separate unconditional insert) is gone.
    // debitCredits must call atomicDebitCredits, not a direct db.insert.
    const fnStart = creditsSrc.indexOf("export async function debitCredits");
    const fnEnd = creditsSrc.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? creditsSrc.slice(fnStart, fnEnd) : creditsSrc.slice(fnStart);
    expect(body).toContain("atomicDebitCredits(");
    // Must NOT have a raw .insert( inside debitCredits body
    expect(body).not.toContain(".insert(");
  });

  it("allowance.ts debitAllowance delegates to atomicDebitAllowance", () => {
    const fnStart = allowanceSrc.indexOf("export async function debitAllowance");
    const fnEnd = allowanceSrc.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? allowanceSrc.slice(fnStart, fnEnd) : allowanceSrc.slice(fnStart);
    expect(body).toContain("atomicDebitAllowance(");
    expect(body).not.toContain(".insert(");
  });
});

// ── D9: Advisory lock runs inside db.transaction ──────────────────────────────
describe("D9 — lock + guard + insert share a single db.transaction", () => {
  it("guardedInsert wraps execution in db.transaction", () => {
    // The lock MUST be taken inside the same transaction as the INSERT so that
    // Postgres releases it atomically on commit/rollback. A lock taken outside a
    // transaction releases immediately and provides no serialization.
    expect(src).toContain("db.transaction(");
  });

  it("pg_advisory_xact_lock is called on the tx client (not bare db)", () => {
    // The lock call must use the transaction executor (tx.execute), not a top-level
    // db.execute — otherwise lock and insert are in separate transactions.
    expect(src).toContain("tx.execute(sql`SELECT pg_advisory_xact_lock");
  });

  it("INSERT-SELECT also uses tx client", () => {
    expect(src).toContain("tx.execute(sql`");
    // Both the lock call and the INSERT use tx.execute — verify both present.
    const lockExecCount = (src.match(/tx\.execute/g) ?? []).length;
    expect(lockExecCount).toBeGreaterThanOrEqual(2);
  });

  it("hashLockKey encodes userId and namespace (djb2 or equivalent)", () => {
    // Key derivation must use both inputs so distinct rails don't share a lock.
    expect(src).toContain("function hashLockKey");
    expect(src).toContain("userId");
    expect(src).toContain("namespace");
  });
});
