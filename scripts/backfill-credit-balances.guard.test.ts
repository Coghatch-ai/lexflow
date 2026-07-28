// scripts/backfill-credit-balances.guard.test.ts
//
// Source-text guards for the backfill SCRIPT's SQL-layer contract (D1, epic #50,
// r2 findings). The pure planner logic (merge / derive / invariant / preflight /
// UPDATE-by-PK selection) is proven behaviourally in
// shared/domain/credit-backfill.test.ts. This file guards the persistence shape
// that only exists in the raw SQL of the script — the parts a live DB would
// otherwise be needed to observe:
//   r2 #1 — the tx LOCKs BOTH rails (SHARE ROW EXCLUSIVE) BEFORE the snapshot read,
//           and the read + merge + write + validate all run in ONE transaction; the
//           post-write validation also fails on any leftover NULL canonical row.
//   r2 #2 — the credit-rail MERGE UPDATEs by PRIMARY KEY (id), never by ref_id.
//   r2 #3 — a reserved-prefix PREFLIGHT runs before any insert.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "backfill-credit-balances.ts"), "utf-8");

describe("r2 #1 — one locked transaction: lock both rails before the snapshot read", () => {
  it("takes SHARE ROW EXCLUSIVE on BOTH credit_ledger and allowance_ledger", () => {
    expect(src).toContain("LOCK TABLE credit_ledger, allowance_ledger IN SHARE ROW EXCLUSIVE MODE");
  });

  it("locks the rails BEFORE loading the legacy snapshot (lock precedes the read)", () => {
    const lockPos = src.indexOf("lockLegacyRails(tx)");
    const readPos = src.indexOf("loadLegacyRows(tx)");
    expect(lockPos).toBeGreaterThan(-1);
    expect(readPos).toBeGreaterThan(-1);
    expect(lockPos).toBeLessThan(readPos);
  });

  it("read + write + validate run inside ONE db.transaction (runMigrationTx)", () => {
    // The whole pipeline is a single tx closure — no read outside a tx that a later
    // tx would then write against (the stale-snapshot bug).
    expect(src).toContain("db.transaction((tx) => runMigrationTx(tx, apply))");
    const fnPos = src.indexOf("async function runMigrationTx");
    const body = src.slice(fnPos);
    // lock → load → write plan all appear inside the one function.
    expect(body.indexOf("lockLegacyRails(tx)")).toBeGreaterThan(-1);
    expect(body.indexOf("loadLegacyRows(tx)")).toBeGreaterThan(body.indexOf("lockLegacyRails(tx)"));
    expect(body.indexOf("runWritePlan(tx")).toBeGreaterThan(body.indexOf("loadLegacyRows(tx)"));
  });

  it("post-write validation ALSO fails on any leftover NULL canonical delta_cents", () => {
    expect(src).toContain("WHERE delta_cents IS NULL");
    expect(src).toMatch(/nullRows > 0[\s\S]*?throw new Error/);
  });
});

describe("r2 #2 — credit-rail merge UPDATEs by PRIMARY KEY, never by nullable ref_id", () => {
  it("the credit-rail UPDATE targets WHERE id = <sourceId>, not WHERE ref_id", () => {
    // Anchor on runWritePlan's real UPDATE (the ROLLBACK-PLAN comment also contains
    // an `UPDATE credit_ledger`, so slice from the function, not the first match).
    const planPos = src.indexOf("async function runWritePlan");
    expect(planPos).toBeGreaterThan(-1);
    const planBody = src.slice(planPos);
    const updPos = planBody.indexOf("UPDATE credit_ledger");
    expect(updPos).toBeGreaterThan(-1);
    const updBlock = planBody.slice(updPos, updPos + 220);
    expect(updBlock).toContain("WHERE id = ${row.sourceId}::uuid");
    expect(updBlock).not.toContain("WHERE ref_id");
  });

  it("has NO `continue` skipping a null-ref_id credit row (they used to be dropped)", () => {
    // The old bug: `if (row.refId === null) continue;` silently skipped a counted row.
    expect(src).not.toContain("a credit row with no ref_id can't be targeted");
    expect(src).not.toMatch(/if \(row\.refId === null\) continue/);
  });
});

describe("r2 #3 — reserved-prefix preflight aborts before any insert", () => {
  it("runs preflightReservedPrefixes before the write plan", () => {
    const preflightPos = src.indexOf("preflightReservedPrefixes(tx)");
    const writePos = src.indexOf("runWritePlan(tx, merged, materialized)");
    expect(preflightPos).toBeGreaterThan(-1);
    expect(writePos).toBeGreaterThan(-1);
    expect(preflightPos).toBeLessThan(writePos);
  });

  it("the preflight uses the shared findReservedPrefixRefIds gate and throws on a hit", () => {
    expect(src).toContain("findReservedPrefixRefIds(refIds)");
    expect(src).toMatch(/offenders\.length > 0[\s\S]*?throw new Error/);
  });
});
