// api/lib/credit-charge-d2.test.ts
//
// D2 source-text guards (epic #50): the funding rails (grant/coupon/subscription/
// admin) now write ONLY through the money core, expiry is append-only, refund is
// demoted to a dormant core writer, and NO raw creditLedger/allowanceLedger insert
// survives outside the money core (one-writer enforcement). The pure reset
// semantics are proven hermetically in shared/domain/credit-reset.test.ts; this
// file guards the persistence/cutover contract at the SQL + call-graph layer.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { expire, grant, refund } from "./credit-charge";
import { CHARGE_LEDGER_REF_PREFIX } from "../../shared/domain/credit-reserved";

const repoRoot = join(import.meta.dirname, "..", "..");
const src = readFileSync(join(import.meta.dirname, "credit-charge.ts"), "utf-8");

describe("D2-A — ONE-WRITER GUARD: no raw creditLedger/allowanceLedger insert outside the money core", () => {
  it("git grep finds `.insert(creditLedger)` / `.insert(allowanceLedger)` ONLY in the money core", () => {
    // The money core (credit-charge.ts) is the SINGLE writer of grant/refund/expiry
    // ledger rows. After D2 no other source file may drizzle-insert either ledger
    // table. (The spend DEBIT engine ledger-debit.ts uses a raw `INSERT INTO
    // ${table}` sql template — a DIFFERENT form — and stays authoritative until D3;
    // it is not a `.insert(<table>)` drizzle call, so it is not matched here.)
    let out = "";
    try {
      out = execSync(
        "git grep -l --untracked -e '\\.insert(creditLedger)' -e '\\.insert(allowanceLedger)' " +
          "-- 'api/**/*.ts' 'shared/**/*.ts' || true",
        { cwd: repoRoot, encoding: "utf-8" },
      );
    } catch {
      out = "";
    }
    const offenders = out
      .split("\n")
      .map((f) => f.trim())
      .filter(
        (f) =>
          f.length > 0 &&
          !f.endsWith(".test.ts") &&
          // The money core itself only MENTIONS `.insert(creditLedger)` in a header
          // comment (its real writes use raw `INSERT INTO … sql`); it is the single
          // allowed writer, so it is not an offender.
          !f.endsWith("api/lib/credit-charge.ts"),
      );
    // No OTHER source file may drizzle-insert either ledger table after D2.
    expect(offenders).toEqual([]);
  });

  it("no `insert(creditLedger)` / `insert(allowanceLedger)` in the funding-rail files", () => {
    // Belt-and-braces at the exact files the PRD names (credits.ts:67/:89 removed,
    // allowance.ts writers, subscription.ts sentinel, credits.router.ts sentinels).
    for (const rel of [
      "api/lib/credits.ts",
      "api/lib/allowance.ts",
      "api/lib/subscription.ts",
      "api/trpc/routers/credits.router.ts",
    ]) {
      const text = readFileSync(join(repoRoot, rel), "utf-8");
      expect(text).not.toMatch(/\.insert\(creditLedger\)/);
      expect(text).not.toMatch(/\.insert\(allowanceLedger\)/);
    }
  });
});

describe("D2-B — grant() legacy-compat mirror keeps the pre-D3 spend admission working", () => {
  it("grant writes the unified credit_ledger + credit_balances upsert in one tx", () => {
    const gPos = src.indexOf("export async function grant");
    const body = src.slice(gPos, src.indexOf("export interface RefundParams"));
    expect(body).toContain("INSERT INTO credit_ledger");
    expect(body).toContain("INSERT INTO credit_balances");
    expect(body).toContain("ON CONFLICT (user_id) DO UPDATE");
  });

  it("grant writes the optional legacyMirror (allowance_ledger) in the SAME tx", () => {
    const gPos = src.indexOf("export async function grant");
    const body = src.slice(gPos, src.indexOf("export interface RefundParams"));
    expect(body).toContain("if (legacyMirror !== undefined)");
    expect(body).toContain("INSERT INTO allowance_ledger");
  });

  it("grant rejects a reserved-prefix refId (money-core boundary, before tx)", async () => {
    await expect(
      grant({
        scope: { userId: "u" },
        cents: 100,
        source: "coupon",
        refId: `${CHARGE_LEDGER_REF_PREFIX}evil`,
        kind: "grant",
      }),
    ).rejects.toThrow(/reserved ledger prefix/);
  });
});

describe("D2-C — refund demoted to a DORMANT core writer (kind=refund)", () => {
  it("refund() writes kind=refund through the core, not a raw insert", () => {
    const rPos = src.indexOf("export async function refund");
    const body = src.slice(rPos, src.indexOf("export interface ExpireParams"));
    expect(body).toContain("'refund'");
    expect(body).toContain("INSERT INTO credit_ledger");
    // Refund never bumps the wallet-gauge anchor (correction, not fresh money-in).
    expect(body).not.toContain("reference_cents = credit_balances");
  });

  it("refund rejects a reserved-prefix refId", async () => {
    await expect(
      refund({
        scope: { userId: "u" },
        cents: 10,
        source: "legacy",
        refId: `${CHARGE_LEDGER_REF_PREFIX}evil`,
      }),
    ).rejects.toThrow(/reserved ledger prefix/);
  });
});

describe("D2-D — expire(): append-only NEGATIVE kind=expiry, deterministic ref_id, one tx", () => {
  it("appends a NEGATIVE kind=expiry ledger row (never delete/rewrite/bare-update)", () => {
    const ePos = src.indexOf("export async function expire");
    const body = src.slice(ePos);
    expect(body).toContain("'expiry'");
    expect(body).toContain("${-amount}");
    // append-only: an INSERT into credit_ledger, and a balance upsert — never a bare
    // UPDATE of an old grant row.
    expect(body).toContain("INSERT INTO credit_ledger");
    expect(body).not.toMatch(/UPDATE\s+credit_ledger/);
  });

  it("uses the deterministic expiryRefId and short-circuits on replay (ON CONFLICT DO NOTHING)", () => {
    const ePos = src.indexOf("export async function expire");
    const body = src.slice(ePos);
    expect(body).toContain("expiryRefId(scope.userId, source, period)");
    expect(body).toContain("ON CONFLICT (ref_id) DO NOTHING");
    expect(body).toContain('outcome: "replay"');
  });

  it("reads the reset knobs LIVE (rolloverKey / expiryMonthsKey) and honors rollover", () => {
    const ePos = src.indexOf("export async function expire");
    const body = src.slice(ePos);
    expect(body).toContain("rolloverKey(source)");
    expect(body).toContain("expiryMonthsKey(source)");
    expect(body).toContain("shouldExpire(policy");
    expect(body).toContain('outcome: policy.rollover ? "rollover" : "not-due"');
  });

  it("balance mutation is INSERT … ON CONFLICT DO UPDATE, never a bare UPDATE credit_balances", () => {
    const ePos = src.indexOf("export async function expire");
    const body = src.slice(ePos);
    expect(body).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(body).not.toMatch(/\bUPDATE\s+credit_balances\b/);
  });

  it("expire is exported (callable by a future scheduled reset routine)", () => {
    expect(typeof expire).toBe("function");
  });

  it("SOURCE/WINDOW-AWARE: claws the expiring source's own SUM(delta_cents), NOT the whole balance", () => {
    const ePos = src.indexOf("export async function expire");
    const body = src.slice(ePos);
    // The clawed amount is derived from THIS source's own ledger rows, filtered by
    // source — never `expiryAmountCents(balance_cents)` over the whole unified row.
    expect(body).toContain("SUM(delta_cents)");
    expect(body).toContain("FROM credit_ledger");
    expect(body).toContain("AND source = ${source}");
    expect(body).toContain("expiryAmountCents(leftover)");
    // The whole-balance clawback bug must be gone: the balance row is still locked
    // FOR UPDATE (serialization) but its balance_cents is NOT the expiry amount.
    expect(body).not.toContain("expiryAmountCents(balance)");
    expect(body).toContain("FOR UPDATE");
  });
});

describe("D2-F — DORMANCY GUARD: expire() is shipped DORMANT (no live/scheduled caller in D2)", () => {
  it("no production source file invokes expire() yet (activation is deferred to D3)", () => {
    // Expiry MUST NOT run against live balances until spend routes through charge()
    // (D3). Mirror the D1 charge() dormancy: fully implemented + tested, but wired to
    // NO live/scheduled caller. git-grep every tracked/untracked .ts under api/ (minus
    // the money core that DEFINES it and this test file) for a call to `expire(` — an
    // offender means someone activated it early, before spend is unified.
    let out = "";
    try {
      out = execSync(
        "git grep -l --untracked -e 'expire(' -- 'api/**/*.ts' 'app/**/*.ts' 'scripts/**/*.ts' || true",
        { cwd: repoRoot, encoding: "utf-8" },
      );
    } catch {
      out = "";
    }
    const offenders = out
      .split("\n")
      .map((f) => f.trim())
      .filter(
        (f) =>
          f.length > 0 &&
          // the money core DEFINES expire(); this file + the pure reset test only reference it.
          f !== "api/lib/credit-charge.ts" &&
          !f.endsWith(".test.ts"),
      );
    expect(offenders).toEqual([]);
  });
});

describe("D2-E — DOUBLE-GRANT GUARD: a grant replay (same ref_id) returns applied=false", () => {
  it("grant returns { applied } so callers can detect a replay and not double-apply", () => {
    const gPos = src.indexOf("export async function grant");
    const body = src.slice(gPos, src.indexOf("export interface RefundParams"));
    // Empty RETURNING on the ledger claim → applied:false (replay). Same ref_id can
    // only grant once (subscription period / coupon redemption idempotency).
    expect(body).toContain("return { applied: false }");
    expect(body).toContain("ON CONFLICT (ref_id) DO NOTHING");
  });

  it("coupon redeem THROWS on a grant replay so the atomic cap increment rolls back", () => {
    const router = readFileSync(join(repoRoot, "api/trpc/routers/credits.router.ts"), "utf-8");
    // claimReplay throws FORBIDDEN when applied=false; the whole tx (incl. the
    // Rail-1 `UPDATE coupons … redeemed_count + 1 … RETURNING`) rolls back, so a
    // double-redeem never permanently burns a redemption slot.
    expect(router).toContain("const claimReplay");
    expect(router).toContain("Você já resgatou este cupom");
    // The atomic per-coupon cap (UPDATE … WHERE redeemed_count < max RETURNING) is
    // preserved (not regressed by the core routing).
    expect(router).toContain("lt(coupons.redeemedCount, coupons.maxRedemptions)");
  });
});
