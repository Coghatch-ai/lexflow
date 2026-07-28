// shared/domain/credit-reset.test.ts
//
// Hermetic acceptance guards for the D2 per-source reset policy (epic #50). The
// DB single writer (api/lib/credit-charge.ts expire()) is a thin tx wrapper over
// these pure primitives, so proving the semantics here proves them there:
//   - deterministic ref_id `<user>:<source>:<period>` (idempotency)
//   - rollover=true  → NO expiry row (leftover carries)
//   - rollover=false, expiry_months=N → negative row at the month-N boundary,
//     balance drops by the leftover, invariant `balance == SUM(delta)` holds
//   - replay: running expire twice for the same (user,source,period) → ONE row
//   - full grant → consume → expire cycle keeps the invariant

import { describe, expect, it } from "vitest";
import { emptyAccount, simulateGrant, simulateCharge, ledgerSum } from "./credit-money";
import {
  rolloverKey,
  expiryMonthsKey,
  expiryRefId,
  resolveResetPolicy,
  shouldExpire,
  expiryAmountCents,
  sourceLeftoverCents,
  simulateExpire,
} from "./credit-reset";

describe("config-key + ref_id conventions", () => {
  it("knob keys are per-source", () => {
    expect(rolloverKey("subscription")).toBe("rollover.subscription");
    expect(expiryMonthsKey("subscription")).toBe("expiry_months.subscription");
    expect(rolloverKey("coupon")).toBe("rollover.coupon");
  });

  it("expiry ref_id is deterministic + carries the real userId (global-unique safe)", () => {
    expect(expiryRefId("u1", "subscription", "2026-07")).toBe("u1:subscription:2026-07");
    // Two users, same source+period → DIFFERENT ref_ids (no cross-user collision).
    expect(expiryRefId("u2", "subscription", "2026-07")).not.toBe(
      expiryRefId("u1", "subscription", "2026-07"),
    );
    // Same user+source+period → identical (replay claims the same key).
    expect(expiryRefId("u1", "subscription", "2026-07")).toBe(
      expiryRefId("u1", "subscription", "2026-07"),
    );
  });
});

describe("resolveResetPolicy — config-driven, safe defaults", () => {
  it("absent knobs → rollover TRUE, never expires (no balance ever lost)", () => {
    expect(resolveResetPolicy(undefined, undefined)).toEqual({ rollover: true, expiryMonths: 0 });
  });

  it("rollover.<source>=0 + expiry_months=3 → expires after 3 months", () => {
    expect(resolveResetPolicy(0, 3)).toEqual({ rollover: false, expiryMonths: 3 });
  });

  it("rollover bool-as-int: any non-zero is rollover on", () => {
    expect(resolveResetPolicy(1, 3).rollover).toBe(true);
    expect(resolveResetPolicy(5, 3).rollover).toBe(true);
    expect(resolveResetPolicy(0, 3).rollover).toBe(false);
  });

  it("negative/non-finite expiry months collapses to 0 (never)", () => {
    expect(resolveResetPolicy(0, -2).expiryMonths).toBe(0);
    expect(resolveResetPolicy(0, Number.NaN).expiryMonths).toBe(0);
  });
});

describe("shouldExpire", () => {
  it("rollover=true → never expires regardless of elapsed", () => {
    expect(shouldExpire({ rollover: true, expiryMonths: 1 }, 99)).toBe(false);
  });

  it("expiryMonths=0 → never expires", () => {
    expect(shouldExpire({ rollover: false, expiryMonths: 0 }, 99)).toBe(false);
  });

  it("rollover=false, N months → expires only at/after the boundary", () => {
    const p = { rollover: false, expiryMonths: 3 };
    expect(shouldExpire(p, 2)).toBe(false);
    expect(shouldExpire(p, 3)).toBe(true);
    expect(shouldExpire(p, 4)).toBe(true);
  });
});

describe("expiryAmountCents — only claws back UNUSED positive leftover", () => {
  it("positive balance → floor(balance)", () => {
    expect(expiryAmountCents(50)).toBe(50);
  });
  it("zero / negative balance → 0 (never deepens a debt)", () => {
    expect(expiryAmountCents(0)).toBe(0);
    expect(expiryAmountCents(-10)).toBe(0);
  });
});

describe("sourceLeftoverCents — per-source net, never the whole unified balance", () => {
  it("nets ONE source's grants minus its own consumption", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 100, "g1");
    simulateCharge(acct, "subscription", 40, "c1", 100); // -40 subscription consumption
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(60);
  });

  it("ignores OTHER sources' rows entirely (no cross-source leak)", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 100, "g1");
    simulateGrant(acct, "purchase", 50, "g2", "purchase");
    simulateGrant(acct, "admin", 30, "g3");
    // subscription leftover is 100 even though the unified balance is 180.
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(100);
    expect(sourceLeftoverCents(acct.ledger, "purchase")).toBe(50);
    expect(sourceLeftoverCents(acct.ledger, "admin")).toBe(30);
  });

  it("clamps a spent-down source to 0 (never negative, never a debt)", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 40, "g1");
    simulateCharge(acct, "subscription", 100, "c1", 100); // over-spent that source
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(0);
  });

  it("unknown source → 0", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    expect(sourceLeftoverCents(acct.ledger, "coupon")).toBe(0);
  });
});

describe("simulateExpire — SOURCE-AWARE: claws only the expiring source's leftover", () => {
  it("subscription grant 100 + subscription consume 40 → expires exactly 60 (not 100)", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    simulateCharge(acct, "subscription", 40, "c1", 100);
    simulateExpire(acct, "u1", "subscription", "2026-07", { rollover: false, expiryMonths: 3 }, 3);
    const expiryRows = acct.ledger.filter((r) => r.kind === "expiry");
    expect(expiryRows).toHaveLength(1);
    expect(expiryRows[0]?.deltaCents).toBe(-60); // the subscription leftover, not the whole balance
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(0);
  });

  it("a coexisting purchase/admin grant is UNTOUCHED by expire({source:subscription})", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 100, "g1");
    simulateGrant(acct, "purchase", 50, "g2", "purchase");
    simulateGrant(acct, "admin", 30, "g3");
    simulateCharge(acct, "subscription", 40, "c1", 100); // subscription leftover = 60
    const before = acct.balanceCents; // 100+50+30-40 = 140
    simulateExpire(acct, "u1", "subscription", "2026-07", { rollover: false, expiryMonths: 1 }, 1);
    // Only the 60 subscription leftover is clawed; purchase 50 + admin 30 roll over.
    expect(acct.balanceCents).toBe(before - 60); // 80
    expect(sourceLeftoverCents(acct.ledger, "purchase")).toBe(50);
    expect(sourceLeftoverCents(acct.ledger, "admin")).toBe(30);
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(0);
    expect(acct.balanceCents).toBe(ledgerSum(acct)); // invariant survives source-aware expiry
  });

  it("expire twice for the same (user,source,period) → exactly ONE row (idempotent)", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 100, "g1");
    simulateGrant(acct, "purchase", 50, "g2", "purchase");
    const policy = { rollover: false, expiryMonths: 1 };
    simulateExpire(acct, "u1", "subscription", "2026-07", policy, 1);
    simulateExpire(acct, "u1", "subscription", "2026-07", policy, 1); // replay
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(1);
    expect(sourceLeftoverCents(acct.ledger, "purchase")).toBe(50); // still untouched on replay
  });

  it("rollover=true → NO expiry row for the source (leftover carries)", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 100, "g1");
    simulateGrant(acct, "purchase", 50, "g2", "purchase");
    simulateExpire(acct, "u1", "subscription", "2026-07", { rollover: true, expiryMonths: 0 }, 99);
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(0);
    expect(sourceLeftoverCents(acct.ledger, "subscription")).toBe(100);
  });
});

describe("simulateExpire — mirrors the DB single writer", () => {
  it("rollover=true → NO expiry row, balance unchanged", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    simulateExpire(acct, "u1", "subscription", "2026-07", { rollover: true, expiryMonths: 0 }, 99);
    expect(acct.balanceCents).toBe(100);
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(0);
    expect(acct.balanceCents).toBe(ledgerSum(acct)); // invariant
  });

  it("rollover=false, N=3, elapsed=3 → negative row, balance drops by leftover, invariant holds", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    simulateCharge(acct, "subscription", 40, "c1", 100); // consume 40 → balance 60
    expect(acct.balanceCents).toBe(60);
    const policy = { rollover: false, expiryMonths: 3 };
    simulateExpire(acct, "u1", "subscription", "2026-07", policy, 3);
    const expiryRows = acct.ledger.filter((r) => r.kind === "expiry");
    expect(expiryRows).toHaveLength(1);
    expect(expiryRows[0]?.deltaCents).toBe(-60); // leftover clawed back
    expect(expiryRows[0]?.refId).toBe("u1:subscription:2026-07");
    expect(acct.balanceCents).toBe(0);
    expect(acct.balanceCents).toBe(ledgerSum(acct)); // invariant after expire
  });

  it("not-yet-due (elapsed < N) → no row", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    simulateExpire(acct, "u1", "subscription", "2026-07", { rollover: false, expiryMonths: 3 }, 2);
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(0);
    expect(acct.balanceCents).toBe(100);
  });

  it("REPLAY: running expire twice for the same (user,source,period) → exactly ONE row", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    const policy = { rollover: false, expiryMonths: 1 };
    simulateExpire(acct, "u1", "subscription", "2026-07", policy, 1);
    simulateExpire(acct, "u1", "subscription", "2026-07", policy, 1); // replay
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(1);
    expect(acct.balanceCents).toBe(0);
    expect(acct.balanceCents).toBe(ledgerSum(acct));
  });

  it("full grant → consume → expire cycle keeps the invariant", () => {
    const acct = emptyAccount();
    simulateGrant(acct, "subscription", 200, "g1");
    simulateGrant(acct, "purchase", 50, "g2", "purchase");
    simulateCharge(acct, "subscription", 30, "c1", 100);
    simulateCharge(acct, "subscription", 25, "c2", 100);
    simulateExpire(acct, "u1", "subscription", "p1", { rollover: false, expiryMonths: 1 }, 1);
    expect(acct.balanceCents).toBe(ledgerSum(acct)); // invariant survives the whole cycle
  });

  it("nothing to expire (already spent to <=0) → no row, no negative-going deeper", () => {
    const acct = simulateGrant(emptyAccount(), "subscription", 100, "g1");
    simulateCharge(acct, "subscription", 100, "c1", 100); // balance 0
    simulateExpire(acct, "u1", "subscription", "p1", { rollover: false, expiryMonths: 1 }, 1);
    expect(acct.ledger.filter((r) => r.kind === "expiry")).toHaveLength(0);
    expect(acct.balanceCents).toBe(0);
  });
});
