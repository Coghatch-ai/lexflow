// api/lib/credit-charge.test.ts
//
// Source-text guards for the AUTHORITATIVE charge() engine (D4, epic #50). The pure
// money semantics are proven hermetically in shared/domain/credit-money.test.ts
// (invariant / replay / sub-cent / bag-crossing over the in-memory model). This
// file guards the PERSISTENCE contract that only exists at the SQL layer — the
// single-writer shape a live DB would otherwise be needed to observe:
//   G1 — balance mutation is INSERT … ON CONFLICT (user_id) DO UPDATE (upsert),
//        NEVER a bare UPDATE of credit_balances (first-write-is-a-charge case).
//   G2 — idempotency claim: INSERT credit_charges … ON CONFLICT (ref_id) DO
//        NOTHING RETURNING; empty → replay early return (bag no re-accumulate).
//   G3 — delivered:false → universal no-op, no transaction opened.
//   G5 — ledger + balance writes are concentrated in this ONE file (single
//        writer): the consumption row and the balance upsert live in the same tx.
//   G6 — NO-LEGACY: no shadow/dryRun mode, no legacy allowance_ledger mirror.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { grant } from "./credit-charge";
import { CHARGE_LEDGER_REF_PREFIX } from "../../shared/domain/credit-reserved";

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
    // charge() now opens its tx via runInTx (joins the caller's tx when supplied —
    // Codex #61 round 3, so the AI persist + consume marker + charge form ONE unit).
    const txPos = chargeSrc.indexOf("runInTx");
    expect(guardPos).toBeGreaterThan(-1);
    expect(guardPos).toBeLessThan(txPos); // guard precedes any tx
  });
});

describe("G4 — NO-LEGACY: charge() is authoritative, no shadow/dryRun, no legacy mirror", () => {
  it("charge() has no dryRun/shadow branch", () => {
    expect(chargeSrc).not.toContain("dryRun");
    expect(chargeSrc).not.toContain("shadow");
    expect(chargeSrc).not.toMatch(/outcome:\s*"shadow"/);
  });

  it("the whole engine never writes the deleted allowance_ledger table (no legacy mirror)", () => {
    expect(src).not.toContain("allowance_ledger");
    expect(src).not.toContain("LegacyMirror");
    expect(src).not.toContain("legacyMirror");
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

  it("source-guard: the reject runs before db.transaction in grant()", () => {
    const grantPos = src.indexOf("export async function grant");
    const grantBody = src.slice(grantPos);
    const rejectPos = grantBody.indexOf("assertExternalRefId");
    const txPos = grantBody.indexOf("db.transaction");
    expect(rejectPos).toBeGreaterThan(-1);
    expect(rejectPos).toBeLessThan(txPos); // reject precedes any tx
  });
});

describe("G11 — atomic unit uses ONE connection: config reads run on the active tx, never global db (r5 #high)", () => {
  // Codex #61 round 5: charge({ tx }) called multiplierFor() which read
  // credit_config on the GLOBAL `db` handle — a hidden SECOND connection inside
  // the supposedly-atomic persist+consume-marker+charge unit. Every read+write of
  // the atomic unit must run on the caller's transaction executor.

  it("multiplierFor takes an executor arg (not just source) so the read threads the tx", () => {
    // Signature carries the executor: multiplierFor(exec, source).
    expect(src).toMatch(/function multiplierFor\(\s*exec:\s*CreditExec\s*,\s*source:\s*string/);
    // Its select runs on the passed executor, NEVER the global db.
    const fnPos = src.indexOf("function multiplierFor");
    const fnBody = src.slice(fnPos, src.indexOf("}", src.indexOf("return row?.value")));
    expect(fnBody).toContain("await exec");
    expect(fnBody).not.toContain("await db");
  });

  it("charge() resolves the multiplier INSIDE runInTx, passing the active tx", () => {
    // The multiplier lookup must sit inside the runInTx callback and receive `tx`,
    // so with a caller tx the config read joins that same transaction/connection.
    const runInTxPos = chargeSrc.indexOf("return runInTx(params.tx");
    const multCallPos = chargeSrc.indexOf("multiplierFor(tx, source)");
    expect(runInTxPos).toBeGreaterThan(-1);
    expect(multCallPos).toBeGreaterThan(runInTxPos); // read is inside the tx callback
  });

  it("charge() NEVER reads the multiplier on the global db (no multiplierFor(db …), no db.select in body)", () => {
    // Guard against a regression back to the global-db handle for the mult lookup.
    expect(chargeSrc).not.toContain("multiplierFor(db");
    expect(chargeSrc).not.toContain("multiplierFor(source)");
    expect(chargeSrc).not.toContain("db.select");
    expect(chargeSrc).not.toContain("await db\n");
  });

  it("expire() reads rollover/expiry_months config on the tx executor, not the global db", () => {
    // Same pattern audited (Codex r5): expire()'s policy read + clawback write are
    // one atomic unit — config reads must run on `tx`, never `db`.
    const expirePos = src.indexOf("export async function expire");
    const expireBody = src.slice(expirePos);
    // The two config selects bind rolloverKey/expiryMonthsKey; they must use `tx`.
    expect(expireBody).toContain("await tx\n      .select({ value: creditConfig.valueInt })");
    // No global-db select survives inside expire().
    const dbSelectPos = expireBody.indexOf("db\n    .select");
    expect(dbSelectPos).toBe(-1);
    // The policy gate now lives inside db.transaction (config read joins the tx).
    const txPos = expireBody.indexOf("return db.transaction");
    const policyPos = expireBody.indexOf("resolveResetPolicy");
    expect(txPos).toBeGreaterThan(-1);
    expect(policyPos).toBeGreaterThan(txPos); // policy resolved inside the tx callback
  });
});

describe("G6 — AUTHORITATIVE: charge() is the SOLE spend path (metered post-delivery)", () => {
  it("the delivered-only metering door (ai-metering) calls charge() for real (no shadow arg)", () => {
    const meter = readFileSync(join(import.meta.dirname, "ai-metering.ts"), "utf-8");
    // charge() is called with delivered but NO dryRun (authoritative).
    expect(meter).toContain("charge({");
    expect(meter).not.toContain("dryRun");
  });

  it("charge() carries the D4 AUTHORITATIVE header (not the old DORMANT/shadow one)", () => {
    expect(src).toContain("AUTHORITATIVE");
    expect(src).not.toContain("SHIPPED DORMANT");
  });
});
