// api/lib/subscription.test.ts
//
// Regression guards for S6 subscription grant paths (issue #53) +
// Codex review:changes F3 fixes.
// Source-text assertions — no live DB needed.
//
// Guards:
//   S1 — grantSubscription upserts subscriptions row with paid plan + active status
//   S2 — period dates computed correctly (start + N months)
//   S3 — monthly allowance granted via grantAllowance with monthly_grant action
//   S4 — idempotency: allowanceRefId = idempotencyKey (not periodStart-keyed)
//   S5 — grantSubscription validates periodMonths >= 1
//   S6 — [F3] idempotencyKey required param; admin call site passes unique key
//   S7 — [F3] period extends from max(existingEnd, now), not always from now
//   S8 — [F3] tx param threaded into grantAllowance (joins same transaction)
//   S9 — [F3 sentinel] subscription upsert guarded by allowance_ledger sentinel
//   S10 — [F3 sentinel] subscriptions row NOT mutated on same-key retry
//   S11 — [QA blocker] sentinel refId ≠ grantAllowance refId (distinct namespace)
//   S12 — [Codex 3rd-pass F1] standalone path wraps impl in db.transaction(); coupon
//          path reuses caller tx without nesting (no double-wrap)

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "subscription.ts"), "utf-8");
const adminSrc = readFileSync(
  join(import.meta.dirname, "../trpc/routers/admin.router.ts"),
  "utf-8",
);

describe("S1 — grantSubscription upserts subscriptions row", () => {
  it("exported", () => {
    expect(src).toContain("export async function grantSubscription");
  });

  it("sets plan to PLAN_PAID", () => {
    expect(src).toContain("plan: PLAN_PAID");
  });

  it("sets status to active", () => {
    expect(src).toContain('status: "active"');
  });

  it("uses onConflictDoUpdate on user_id (idempotent upsert)", () => {
    expect(src).toContain("onConflictDoUpdate");
    expect(src).toContain("target: subscriptions.userId");
  });
});

describe("S2 — period dates use setMonth for N-month offset", () => {
  it("uses endDate.setMonth to compute period end", () => {
    expect(src).toContain("endDate.setMonth");
  });

  it("currentPeriodStart set to periodStartIso", () => {
    expect(src).toContain("currentPeriodStart: periodStartIso");
  });

  it("currentPeriodEnd set to periodEnd", () => {
    expect(src).toContain("currentPeriodEnd: periodEnd");
  });
});

describe("S3 — monthly allowance granted via grantAllowance", () => {
  it("calls grantAllowance", () => {
    expect(src).toContain("grantAllowance(");
  });

  it("action is monthly_grant", () => {
    expect(src).toContain('"monthly_grant"');
  });

  it("reads MONTHLY_ALLOWANCE_UNITS from config (no hardcoded number)", () => {
    expect(src).toContain("CONFIG_KEYS.MONTHLY_ALLOWANCE_UNITS");
  });
});

describe("S4 — allowance grant refId is idempotencyKey (not periodStart)", () => {
  it("idempotencyKey passed as refId to grantAllowance", () => {
    // The refId arg must be idempotencyKey, not a constructed periodStart string.
    expect(src).toContain("idempotencyKey,");
  });

  it("old sub:monthly periodStart-keyed refId pattern is gone", () => {
    // Prior pattern: `sub:monthly:${userId}:${periodStart}` as the constructed refId.
    // With F3 the refId comes from the caller, so this constructed string is absent.
    expect(src).not.toContain("sub:monthly:${userId}:${periodStart}");
  });
});

describe("S5 — periodMonths validation", () => {
  it("throws when periodMonths < 1", () => {
    expect(src).toContain("periodMonths < 1");
  });

  it("error message names periodMonths", () => {
    expect(src).toContain("periodMonths must be >= 1");
  });
});

describe("S6 — [F3] idempotencyKey is a required parameter (Codex finding #3)", () => {
  it("grantSubscription signature includes idempotencyKey param", () => {
    expect(src).toContain("idempotencyKey: string");
  });

  it("admin.router passes idempotencyKey to grantSubscription", () => {
    expect(adminSrc).toContain("idempotencyKey");
    expect(adminSrc).toContain("sub:admin:");
  });

  it("admin idempotencyKey uses randomUUID for uniqueness per call", () => {
    expect(adminSrc).toContain("randomUUID()");
    // Each admin grant gets a fresh UUID → no stacking on repeated clicks,
    // but distinct clicks each get their own allowance grant (correct behaviour).
    const keyLine = adminSrc.indexOf("sub:admin:");
    const uuidLine = adminSrc.indexOf("randomUUID()");
    expect(keyLine).toBeGreaterThan(-1);
    expect(uuidLine).toBeGreaterThan(-1);
  });
});

describe("S7 — [F3] period extends from max(existingEnd, now) (Codex finding #3)", () => {
  it("reads existing subscription before computing periodStart", () => {
    // FOR UPDATE raw query returns snake_case column; check either accessor form.
    expect(src).toMatch(/existing\?\.current_period_end|existing\?\.currentPeriodEnd/);
  });

  it("periodStart derived from max(existingEnd, now)", () => {
    // existingEnd > now check present
    expect(src).toContain("existingEnd > now");
  });

  it("period does not always reset to new Date() (existingEnd used when future)", () => {
    // Confirm there is a branch that sets periodStart = existingEnd (not only now).
    expect(src).toContain("periodStart = existingEnd");
  });
});

describe("S8 — [F3] tx param threaded into grantAllowance (Codex finding #1+3)", () => {
  it("grantSubscription accepts optional tx param", () => {
    expect(src).toContain("tx?: DbOrTx");
  });

  it("grantAllowance call passes tx", () => {
    // Call spans multiple lines; use a multiline-aware pattern.
    expect(src).toMatch(/grantAllowance\([\s\S]*?,\s*tx[,\s)]/m);
  });

  it("subscriptions upsert uses executor param, not bare db", () => {
    // After the F1 atomicity fix the public fn delegates to grantSubscriptionImpl
    // with a required executor; the old `tx ?? db` coalesce is now an if/else
    // branch in the public wrapper — the impl itself always receives an executor.
    expect(src).toContain("executor");
    // impl signature requires executor (no optional)
    expect(src).toContain("executor: DbOrTx,");
  });
});

describe("S9 — [F3 sentinel] subscription upsert guarded by allowance_ledger sentinel (Codex re-review)", () => {
  it("imports allowanceLedger from schema", () => {
    // sentinel insert uses the allowanceLedger table
    expect(src).toContain("allowanceLedger");
    expect(src).toContain("{ allowanceLedger, subscriptions }");
  });

  it("sentinel insert uses onConflictDoNothing on refId", () => {
    expect(src).toContain("onConflictDoNothing({ target: allowanceLedger.refId })");
  });

  it("sentinel uses .returning to detect first-vs-retry", () => {
    expect(src).toContain(".returning({ id: allowanceLedger.id })");
  });

  it("short-circuits (returns early) when sentinel returns 0 rows", () => {
    expect(src).toContain("sentinelResult.length === 0");
    expect(src).toMatch(/sentinelResult\.length === 0[\s\S]*?return;/m);
  });

  it("sentinel insert happens BEFORE the subscriptions upsert", () => {
    const sentinelPos = src.indexOf("onConflictDoNothing({ target: allowanceLedger.refId })");
    const upsertPos = src.indexOf("onConflictDoUpdate");
    expect(sentinelPos).toBeGreaterThan(-1);
    expect(upsertPos).toBeGreaterThan(-1);
    expect(sentinelPos).toBeLessThan(upsertPos);
  });

  it("sentinel delta is 0 (zero-delta sentinel, not a real grant)", () => {
    // The sentinel row must carry delta: 0 so it does not affect balance.
    expect(src).toContain("delta: 0");
  });

  it("sentinel refId is namespaced sub:sentinel:<key> (not bare idempotencyKey)", () => {
    // The sentinel must use a DISTINCT ref_id from the real allowance grant.
    // If both used `refId: idempotencyKey` the allowance insert would hit
    // onConflictDoNothing on the first call → subscriber gets zero allowance.
    // Fixed: sentinel uses `sub:sentinel:${idempotencyKey}` template literal.
    expect(src).toContain("sub:sentinel:");
    expect(src).toContain("sentinelRefId");
    expect(src).toContain("refId: sentinelRefId");
    // Must NOT use bare idempotencyKey as the sentinel refId.
    expect(src).not.toMatch(/refId:\s*idempotencyKey[^,\n]*,\s*\n\s*note:\s*`sentinel:/);
  });
});

describe("S11 — [QA blocker] sentinel refId ≠ grantAllowance refId (distinct namespace)", () => {
  it("sentinel row uses sub:sentinel: prefix", () => {
    // Sentinel must be namespaced so it cannot collide with the real grant row.
    expect(src).toContain("`sub:sentinel:${idempotencyKey}`");
  });

  it("grantAllowance call passes bare idempotencyKey (no prefix)", () => {
    // The real allowance top-up must use refId = idempotencyKey (no sentinel prefix).
    // This is what actually lands in allowance_ledger with delta=units.
    expect(src).toContain("idempotencyKey,");
    // And it must NOT pass sentinelRefId to grantAllowance.
    expect(src).not.toContain(
      'grantAllowance(\n      userId,\n      units,\n      "monthly_grant",\n      sentinelRefId,',
    );
  });

  it("two distinct ref_ids produced per first-time call (sentinel prefix + bare key)", () => {
    // Both patterns must appear in source: the namespaced sentinel and the bare key grant.
    expect(src).toContain("sentinelRefId"); // namespaced sentinel variable
    expect(src).toContain("refId: sentinelRefId"); // sentinel insert uses it
    // grantAllowance is called with idempotencyKey (not sentinelRefId)
    const grantPos = src.indexOf("grantAllowance(");
    const sentinelAssign = src.indexOf("const sentinelRefId");
    // sentinel is declared before grantAllowance call
    expect(sentinelAssign).toBeGreaterThan(-1);
    expect(grantPos).toBeGreaterThan(sentinelAssign);
    // grantAllowance region does not contain sentinelRefId
    const grantRegion = src.slice(grantPos, grantPos + 200);
    expect(grantRegion).not.toContain("sentinelRefId");
    expect(grantRegion).toContain("idempotencyKey");
  });
});

describe("S10 — [F3 sentinel] subscriptions row NOT mutated on same-key retry", () => {
  it("subscription upsert is inside the sentinel guard (after early-return)", () => {
    // After `if (sentinelResult.length === 0) { return; }` the upsert follows.
    // Verify the upsert is NOT before the sentinel check.
    const earlyReturnPos = src.indexOf("sentinelResult.length === 0");
    const upsertPos = src.indexOf("onConflictDoUpdate");
    expect(earlyReturnPos).toBeGreaterThan(-1);
    expect(upsertPos).toBeGreaterThan(-1);
    // early-return guard comes before the upsert
    expect(earlyReturnPos).toBeLessThan(upsertPos);
  });

  it("old pattern absent: no unconditional subscription upsert before sentinel", () => {
    // Before the fix the upsert ran before any idempotency check.
    // Sentinel check (sentinelResult) must exist as the only gate.
    expect(src).toContain("sentinelResult");
    // Confirm onConflictDoUpdate appears exactly once (the gated upsert).
    const matches = src.match(/onConflictDoUpdate/g);
    expect(matches).toHaveLength(1);
  });
});

describe("S13 — [#55] FOR UPDATE on subscription row read serializes concurrent grants", () => {
  it("FOR UPDATE present in subscription.ts", () => {
    expect(src).toContain("FOR UPDATE");
  });

  it("FOR UPDATE appears before periodStart computation", () => {
    const forUpdatePos = src.indexOf("FOR UPDATE");
    const periodStartPos = src.indexOf("let periodStart:");
    expect(forUpdatePos).toBeGreaterThan(-1);
    expect(periodStartPos).toBeGreaterThan(-1);
    expect(forUpdatePos).toBeLessThan(periodStartPos);
  });

  it("executor.execute used (FOR UPDATE on same tx connection)", () => {
    expect(src).toContain("executor.execute(sql");
  });

  it("DbOrTx Pick includes execute", () => {
    expect(src).toContain('"execute"');
  });

  it("existing row access uses snake_case current_period_end from raw SQL result", () => {
    expect(src).toContain("current_period_end");
  });
});

describe("S14 — [#55 Codex re-review] per-user advisory lock serializes first-grant race", () => {
  // FOR UPDATE only locks an EXISTING subscriptions row. Two concurrent
  // distinct-key grants on a new user both succeed the sentinel insert (keyed
  // by idempotencyKey, not userId), both SELECT FOR UPDATE lock zero rows, and
  // both compute the same periodStart → second write overwrites the first
  // extension. Fix: pg_advisory_xact_lock(hashLockKey(userId,"subscription"))
  // taken as the FIRST statement in grantSubscriptionImpl, before the sentinel
  // insert, on the same tx executor. The second concurrent grant blocks until
  // the first commits, then reads the updated current_period_end.
  //
  // Honest limit: a live-Postgres two-concurrent-grants test (two distinct
  // idempotency keys → period extended twice, not once) is needed pre-deploy;
  // no DB harness here — source-text guards are the strongest tractable proof.

  it("hashLockKey imported from ledger-debit (reuse shared primitive)", () => {
    expect(src).toContain('from "./ledger-debit"');
    expect(src).toContain("hashLockKey");
  });

  it('pg_advisory_xact_lock taken with hashLockKey(userId, "subscription")', () => {
    expect(src).toContain('hashLockKey(userId, "subscription")');
    expect(src).toContain("pg_advisory_xact_lock");
  });

  it("advisory lock taken via executor.execute (same tx connection)", () => {
    // Must use executor, not bare db, so the lock is held in the same
    // transaction as the sentinel insert + subscription upsert.
    expect(src).toMatch(/executor\.execute\(sql`SELECT pg_advisory_xact_lock/);
  });

  it("advisory lock taken BEFORE sentinel insert (serializes before any write)", () => {
    const lockPos = src.indexOf("pg_advisory_xact_lock");
    const sentinelPos = src.indexOf("onConflictDoNothing({ target: allowanceLedger.refId })");
    expect(lockPos).toBeGreaterThan(-1);
    expect(sentinelPos).toBeGreaterThan(-1);
    expect(lockPos).toBeLessThan(sentinelPos);
  });

  it("advisory lock taken BEFORE FOR UPDATE read (full serialization)", () => {
    const lockPos = src.indexOf("pg_advisory_xact_lock");
    // Use the executor.execute call that contains FOR UPDATE (skip comment occurrences)
    const forUpdatePos = src.indexOf("const existingResult = await executor.execute(sql`");
    expect(lockPos).toBeGreaterThan(-1);
    expect(forUpdatePos).toBeGreaterThan(-1);
    expect(lockPos).toBeLessThan(forUpdatePos);
  });

  it("namespace is 'subscription' (distinct from allowance/credit rails)", () => {
    expect(src).toContain('"subscription"');
    // Confirm the string appears in the hashLockKey call context
    expect(src).toMatch(/hashLockKey\(userId,\s*"subscription"\)/);
  });
});

describe("S12 — [Codex 3rd-pass F1] standalone/admin path is atomic (db.transaction wrapper)", () => {
  it("internal impl function exists (grantSubscriptionImpl)", () => {
    // The write chain lives in a private impl so both paths (standalone + coupon)
    // share identical logic; only the executor differs.
    expect(src).toContain("async function grantSubscriptionImpl(");
  });

  it("standalone path calls db.transaction() — not the raw executor branch", () => {
    // When no tx is passed the public function must open a fresh db.transaction().
    // Guards: a mid-chain failure rolls back sentinel + subscription upsert atomically.
    expect(src).toContain("db.transaction(async (innerTx) =>");
  });

  it("standalone path invokes grantSubscriptionImpl inside db.transaction callback", () => {
    // The impl must be called with innerTx, not with db directly.
    expect(src).toContain(
      "await grantSubscriptionImpl(userId, periodMonths, idempotencyKey, units, note, innerTx)",
    );
  });

  it("coupon path reuses caller tx WITHOUT opening a nested db.transaction()", () => {
    // When tx is defined, the public function calls impl(... tx) directly —
    // no second db.transaction() call that would nest inside the coupon's tx.
    // Structural guard: the tx-defined branch uses grantSubscriptionImpl with tx,
    // not another db.transaction() invocation.
    expect(src).toContain(
      "await grantSubscriptionImpl(userId, periodMonths, idempotencyKey, units, note, tx)",
    );
    // db.transaction(async ... appears exactly once in non-comment code lines.
    // Filter out comment lines (// ...) before counting to avoid false positives
    // from JSDoc / inline comments that mention db.transaction() in prose.
    const codeLines = src.split("\n").filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l));
    const codeOnly = codeLines.join("\n");
    const txMatches = codeOnly.match(/db\.transaction\(/g);
    expect(txMatches).toHaveLength(1);
  });

  it("config read (getConfigNumber) happens BEFORE the db.transaction call", () => {
    // The units value is read outside the transaction so a config error never
    // leaves a partial sentinel committed inside an otherwise-rolled-back tx.
    const configPos = src.indexOf("getConfigNumber(CONFIG_KEYS.MONTHLY_ALLOWANCE_UNITS)");
    const txPos = src.indexOf("db.transaction(async (innerTx) =>");
    expect(configPos).toBeGreaterThan(-1);
    expect(txPos).toBeGreaterThan(-1);
    expect(configPos).toBeLessThan(txPos);
  });

  it("grantAllowance inside impl uses executor param (not bare db)", () => {
    // Inside grantSubscriptionImpl the grantAllowance call must pass executor,
    // not the module-level db, so it participates in the same transaction.
    const implStart = src.indexOf("async function grantSubscriptionImpl(");
    const implEnd = src.indexOf("export async function grantSubscription(");
    const implBody = src.slice(implStart, implEnd);
    // grantAllowance last arg must be executor (not tx or db)
    expect(implBody).toMatch(/grantAllowance\([\s\S]*?,\s*executor[,\s)]/m);
  });
});
