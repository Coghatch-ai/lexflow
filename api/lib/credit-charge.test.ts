// api/lib/credit-charge.test.ts
//
// Source-text guards for the dormant D1 charge() engine (epic #50). The pure
// money semantics are proven hermetically in shared/domain/credit-money.test.ts
// (invariant / replay / sub-cent / bag-crossing over the in-memory model). This
// file guards the PERSISTENCE contract that only exists at the SQL layer — the
// single-writer shape a live DB would otherwise be needed to observe:
//   G1 — balance mutation is INSERT … ON CONFLICT (user_id) DO UPDATE (upsert),
//        NEVER a bare UPDATE of credit_balances (first-write-is-a-charge case).
//   G2 — idempotency claim: INSERT credit_charges … ON CONFLICT (ref_id) DO
//        NOTHING RETURNING; empty → replay early return (bag no re-accumulate).
//   G3 — delivered:false → universal no-op, no transaction opened.
//   G4 — dryRun → shadow, writes nothing (no INSERT inside the dryRun branch).
//   G5 — ledger + balance writes are concentrated in this ONE file (single
//        writer): the consumption row and the balance upsert live in the same tx.
//   G6 — DORMANT: no call site imports charge() yet (D3 wires it).

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { grant } from "./credit-charge";
import {
  CHARGE_LEDGER_REF_PREFIX,
  LEGACY_ALLOWANCE_REF_PREFIX,
} from "../../shared/domain/credit-reserved";

const src = readFileSync(join(import.meta.dirname, "credit-charge.ts"), "utf-8");

describe("G1 — balance mutation is INSERT … ON CONFLICT DO UPDATE, never bare UPDATE", () => {
  it("uses INSERT INTO credit_balances … ON CONFLICT (user_id) DO UPDATE", () => {
    expect(src).toContain("INSERT INTO credit_balances");
    expect(src).toContain("ON CONFLICT (user_id) DO UPDATE");
  });

  it("has NO bare `UPDATE credit_balances` statement (only the upsert path)", () => {
    // A bare UPDATE would silently no-op when the user has no balance row yet
    // (first write is a charge). Only the ON CONFLICT DO UPDATE clause is allowed.
    expect(src).not.toMatch(/\bUPDATE\s+credit_balances\b/);
  });
});

describe("G2 — idempotency via credit_charges ON CONFLICT DO NOTHING RETURNING", () => {
  it("claims the ref_id in credit_charges before any mutation", () => {
    expect(src).toContain("INSERT INTO credit_charges");
    expect(src).toContain("ON CONFLICT (ref_id) DO NOTHING");
    expect(src).toContain("RETURNING ref_id");
  });

  it("empty RETURNING → replay early return (bag does NOT re-accumulate)", () => {
    // The replay branch must return BEFORE reading/writing the bag.
    const claimPos = src.indexOf("INSERT INTO credit_charges");
    const replayPos = src.indexOf('outcome: "replay"');
    const bagReadPos = src.indexOf("SELECT coalesce(bag_cents");
    expect(claimPos).toBeGreaterThan(-1);
    expect(replayPos).toBeGreaterThan(claimPos);
    expect(replayPos).toBeLessThan(bagReadPos); // replay returns before bag read
  });
});

// charge()-scoped source (the runInTx helper mentions db.transaction earlier in
// the file for grant/refund; scope these guards to charge()'s own body so they
// measure charge()'s control flow, not the shared helper).
const chargeSrc = src.slice(
  src.indexOf("export async function charge"),
  src.indexOf("export interface GrantParams"),
);

describe("G3 — delivered:false is a universal no-op (no tx)", () => {
  it("returns no-op before opening a transaction when !delivered", () => {
    expect(chargeSrc).toContain("if (!delivered)");
    const guardPos = chargeSrc.indexOf("if (!delivered)");
    const txPos = chargeSrc.indexOf("db.transaction");
    expect(guardPos).toBeGreaterThan(-1);
    expect(guardPos).toBeLessThan(txPos); // guard precedes any tx
  });
});

describe("G4 — dryRun is shadow: writes nothing", () => {
  it("dryRun branch returns before db.transaction and contains no INSERT", () => {
    const dryPos = chargeSrc.indexOf("if (dryRun)");
    const txPos = chargeSrc.indexOf("db.transaction");
    expect(dryPos).toBeGreaterThan(-1);
    expect(dryPos).toBeLessThan(txPos);
    // The dryRun block (between `if (dryRun)` and the following `return db.transaction`)
    // must not contain an INSERT.
    const block = chargeSrc.slice(dryPos, txPos);
    expect(block).not.toContain("INSERT");
  });
});

describe("G5 — single writer: ledger + balance mutated in the same transaction", () => {
  it("the consumption ledger row and balance upsert are both inside db.transaction", () => {
    const txPos = src.indexOf("return db.transaction");
    const tail = src.slice(txPos);
    expect(tail).toContain("INSERT INTO credit_balances");
    expect(tail).toContain("INSERT INTO credit_ledger");
    expect(tail).toContain("'consumption'");
  });

  it("consumption row delta_cents equals the balance decrement (-flushCents)", () => {
    // Both the balance DO UPDATE and the ledger row use the same -flushCents.
    expect(src).toContain("balance_cents = credit_balances.balance_cents - ${flushCents}");
    expect(src).toContain("${-flushCents}");
  });

  it("sub-cent (flushCents < 1) writes NO ledger row but keeps the bag", () => {
    expect(src).toContain("if (flushCents < 1)");
    expect(src).toContain('outcome: "sub-cent"');
  });
});

describe("G7 — consumption ledger insert FAILS LOUD on an unexpected ref_id collision", () => {
  it("the consumption INSERT uses RETURNING and throws when no row was inserted", () => {
    // The critical fix: `ON CONFLICT (ref_id) DO NOTHING` alone could silently
    // skip the ledger row after the balance was already debited → invariant break
    // (balance_cents < SUM(delta)). The insert must RETURNING id and THROW on an
    // empty result so the whole tx rolls back. Guard the exact shape at the source.
    const insPos = src.indexOf("INSERT INTO credit_ledger");
    expect(insPos).toBeGreaterThan(-1);
    const insBlock = src.slice(insPos);
    // RETURNING id on the consumption insert (the first credit_ledger insert = charge).
    expect(insBlock).toContain("RETURNING id");
    // A throw guards the empty-RETURNING case (rollback, not silent commit).
    expect(src).toMatch(/ledgerInsert[\s\S]*?length === 0[\s\S]*?throw new Error/);
  });

  it("idempotency/replay is owned by credit_charges, NOT by the ledger insert", () => {
    // The replay early-return keys off the credit_charges claim's empty RETURNING;
    // the ledger insert's empty RETURNING is a HARD ERROR, never a replay signal.
    const chargesClaim = src.indexOf('outcome: "replay"');
    const ledgerThrow = src.indexOf("credit_ledger consumption insert no-op");
    expect(chargesClaim).toBeGreaterThan(-1);
    expect(ledgerThrow).toBeGreaterThan(chargesClaim);
  });
});

describe("G8 — per-user serialization: balance row is created + locked FOR UPDATE before the bag read", () => {
  it("locks the credit_balances row (FOR UPDATE) before reading bag_cents", () => {
    // Two concurrent delivered charges must not read the same stale bag. The row
    // is upserted (created-if-missing) then SELECT … FOR UPDATE, so the second
    // charge blocks until the first commits.
    const forUpdatePos = src.indexOf("FOR UPDATE");
    const bagReadPos = src.indexOf("SELECT coalesce(bag_cents");
    expect(forUpdatePos).toBeGreaterThan(-1);
    // FOR UPDATE is part of the bag SELECT (same statement).
    expect(src.slice(bagReadPos, bagReadPos + 200)).toContain("FOR UPDATE");
    // A create-if-missing upsert precedes the locking select (row must exist to lock).
    const createIfMissing = src.indexOf("ON CONFLICT (user_id) DO NOTHING");
    expect(createIfMissing).toBeGreaterThan(-1);
    expect(createIfMissing).toBeLessThan(bagReadPos);
  });
});

describe("G9 — ledger consumption ref_id is NAMESPACED (charge:) to avoid cross-writer collision", () => {
  it("the consumption row uses chargeLedgerRefId(refId), never the raw refId", () => {
    // CHARGE_LEDGER_REF_PREFIX now lives in shared/domain/credit-reserved.ts (the
    // single reserved-prefix registry); credit-charge.ts re-exports it.
    expect(src).toContain("CHARGE_LEDGER_REF_PREFIX");
    expect(src).toContain("export { CHARGE_LEDGER_REF_PREFIX }");
    expect(src).toContain("const ledgerRefId = chargeLedgerRefId(refId)");
    // The credit_ledger insert binds ledgerRefId, not the raw ${refId}.
    const insPos = src.indexOf("INSERT INTO credit_ledger");
    const insBlock = src.slice(insPos, insPos + 400);
    expect(insBlock).toContain("${ledgerRefId}");
  });

  it("the canonical prefix constant is 'charge:' (asserted at its shared home)", () => {
    expect(CHARGE_LEDGER_REF_PREFIX).toBe("charge:");
  });
});

describe("G10 — grant() REJECTS a caller refId that squats a reserved internal prefix (r2 #3)", () => {
  it("throws (before opening any tx) on a `charge:`-prefixed refId", async () => {
    // grant() writes the caller's raw refId into the GLOBAL credit_ledger.ref_id. A
    // reserved-prefix refId would shadow a later charge/backfill row → reject at the
    // money-core boundary. The reject is synchronous, BEFORE db.transaction, so this
    // is hermetic (never touches the DB).
    await expect(
      grant({
        scope: { userId: "u" },
        cents: 100,
        source: "admin",
        refId: `${CHARGE_LEDGER_REF_PREFIX}evil`,
        kind: "grant",
      }),
    ).rejects.toThrow(/reserved ledger prefix/);
  });

  it("throws on a `legacy_allowance:`-prefixed refId", async () => {
    await expect(
      grant({
        scope: { userId: "u" },
        cents: 100,
        source: "coupon",
        refId: `${LEGACY_ALLOWANCE_REF_PREFIX}x`,
        kind: "grant",
      }),
    ).rejects.toThrow(/reserved ledger prefix/);
  });

  it("source-guard: the reject runs before db.transaction in grant()", () => {
    const grantPos = src.indexOf("export async function grant");
    const grantBody = src.slice(grantPos);
    const rejectPos = grantBody.indexOf("assertExternalRefId");
    const txPos = grantBody.indexOf("db.transaction");
    expect(rejectPos).toBeGreaterThan(-1);
    expect(rejectPos).toBeLessThan(txPos); // reject precedes any tx
  });
});

describe("G6 — D2: the GRANT-side funding rails now wire the money core (charge() still dormant, D3)", () => {
  it("the funding-rail files IMPORT credit-charge (grant/refund/expire wired in D2)", () => {
    // D1 shipped charge()/grant() dormant; D2 routes the GRANT/refund/coupon/
    // subscription/admin WRITE side through the money core. So the funding-rail
    // files MUST now import it. (The SPEND `charge()` call sites are still D3.)
    let out = "";
    try {
      out = execSync(
        "git grep -l --untracked -e \"from ['\\\"].*credit-charge['\\\"]\" -- 'api/**/*.ts' 'shared/**/*.ts' 'app/**/*.ts' || true",
        { cwd: join(import.meta.dirname, "..", ".."), encoding: "utf-8" },
      );
    } catch {
      out = "";
    }
    const files = out
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.endsWith(".test.ts"));
    // Exactly the D2 grant-rail importers (order-independent).
    expect(files.sort()).toEqual(
      [
        "api/lib/allowance.ts",
        "api/lib/credits.ts",
        "api/lib/subscription.ts",
        "api/trpc/routers/credits.router.ts",
      ].sort(),
    );
  });

  it("no SPEND call site invokes charge() yet (D3 wires delivered-only charging)", () => {
    // charge() (the metered SPEND writer) stays dormant in D2 — grep for a call,
    // not just an import. The grant rails import grant()/refund()/expire(), never
    // charge(); the AI routers must not call charge( until D3.
    let out = "";
    try {
      out = execSync(
        "git grep -n --untracked -e 'charge(' -- 'api/trpc/**/*.ts' | grep -v '\\.test\\.ts' || true",
        { cwd: join(import.meta.dirname, "..", ".."), encoding: "utf-8" },
      );
    } catch {
      out = "";
    }
    // No `charge(` invocation in the routers (grant/refund/expire are fine; those
    // are money-IN / reset, not the dormant metered spend writer).
    const spendCalls = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && /[^a-zA-Z_.]charge\(/.test(` ${l}`) && !/\/\//.test(l));
    expect(spendCalls).toEqual([]);
  });
});
