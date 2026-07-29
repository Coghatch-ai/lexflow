// shared/domain/credit-money.test.ts
//
// D1 acceptance suite (epic #50) for the pure money core. These run hermetically
// — no DB — because the arithmetic + the in-memory account model
// (simulateCharge/simulateGrant) mirror EXACTLY what api/lib/credit-charge.ts does
// to (balance_cents, bag_cents, ledger). The engine is a thin transaction wrapper
// over these primitives, so a divergence here is a divergence there.

import { describe, expect, it } from "vitest";
import {
  applyMultiplier,
  capRawCents,
  clampMultiplierX100,
  flushBag,
  emptyAccount,
  simulateCharge,
  simulateGrant,
  ledgerSum,
  walletPercent,
  MULT_DEFAULT_X100,
  MULT_MAX_X100,
  RAW_CENTS_CAP,
} from "./credit-money";

// Deterministic LCG so the invariant "property" test is reproducible without a dep.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe("applyMultiplier — fractional, never rounded", () => {
  it("identity multiplier (100 = 1x) returns raw unchanged", () => {
    expect(applyMultiplier(23, 100)).toBe(23);
  });

  it("2x doubles, 0.5x halves — fractional preserved", () => {
    expect(applyMultiplier(23, 200)).toBe(46);
    expect(applyMultiplier(1, 50)).toBe(0.5); // sub-cent, NOT rounded to 0 or 1
    expect(applyMultiplier(3, 33)).toBeCloseTo(0.99, 10);
  });

  it("clamps multiplier to [0, MULT_MAX_X100]", () => {
    expect(clampMultiplierX100(-5)).toBe(0);
    expect(clampMultiplierX100(MULT_MAX_X100 + 1)).toBe(MULT_MAX_X100);
    expect(clampMultiplierX100(Number.NaN)).toBe(0);
    expect(applyMultiplier(100, MULT_MAX_X100 + 999)).toBe((100 * MULT_MAX_X100) / 100);
  });

  it("caps rawCents and rejects negative/non-finite", () => {
    expect(capRawCents(-1)).toBe(0);
    expect(capRawCents(RAW_CENTS_CAP + 1)).toBe(RAW_CENTS_CAP);
    expect(capRawCents(Number.POSITIVE_INFINITY)).toBe(0);
    expect(applyMultiplier(-10, 200)).toBe(0);
  });

  it("MULT_DEFAULT_X100 is identity (unlisted source → 1x)", () => {
    expect(MULT_DEFAULT_X100).toBe(100);
  });
});

describe("flushBag — floor to whole cents, retain sub-cent remainder", () => {
  it("floor(bag+owed) is the flush; remainder in [0,1)", () => {
    expect(flushBag(0, 0.5)).toEqual({ flushCents: 0, remainderCents: 0.5 });
    expect(flushBag(0.5, 0.5)).toEqual({ flushCents: 1, remainderCents: 0 });
    const r = flushBag(0.7, 0.6);
    expect(r.flushCents).toBe(1);
    expect(r.remainderCents).toBeCloseTo(0.3, 10);
  });

  it("negative/non-finite inputs are treated as 0", () => {
    expect(flushBag(-5, -5)).toEqual({ flushCents: 0, remainderCents: 0 });
    expect(flushBag(Number.NaN, 2.5)).toEqual({ flushCents: 2, remainderCents: 0.5 });
  });
});

describe("D1 invariant — balance_cents == SUM(ledger.delta_cents)", () => {
  it("holds over a randomized charge/grant sequence for many users", () => {
    const rand = lcg(20250728);
    for (let user = 0; user < 40; user++) {
      const acct = emptyAccount();
      const ops = 5 + Math.floor(rand() * 40);
      for (let i = 0; i < ops; i++) {
        const refId = `u${String(user)}:op${String(i)}`;
        if (rand() < 0.4) {
          simulateGrant(acct, "subscription", 100 + Math.floor(rand() * 500), refId);
        } else {
          const raw = Math.floor(rand() * 300); // cents, includes 0
          const mult = Math.floor(rand() * 400); // 0..4x
          simulateCharge(acct, "legacy", raw, refId, mult);
        }
      }
      expect(acct.balanceCents).toBe(ledgerSum(acct));
    }
  });

  it("holds for a user whose FIRST write is a charge (not a grant)", () => {
    const acct = emptyAccount();
    // First op = a charge that flushes (raw 250, 1x → 250¢ consumption).
    simulateCharge(acct, "legacy", 250, "first:charge", MULT_DEFAULT_X100);
    expect(acct.balanceCents).toBe(-250); // negative balance kept REAL
    expect(acct.balanceCents).toBe(ledgerSum(acct));
    // Subsequent grant recovers.
    simulateGrant(acct, "subscription", 1000, "g1");
    expect(acct.balanceCents).toBe(750);
    expect(acct.balanceCents).toBe(ledgerSum(acct));
  });
});

describe("D1 replay — same ref_id twice is a no-op, bag does NOT re-accumulate", () => {
  it("second charge with same refId does not move balance, bag, or ledger", () => {
    const acct = emptyAccount();
    // Sub-cent charge: raw 1, 0.5x → owed 0.5, bag=0.5, no ledger row.
    simulateCharge(acct, "legacy", 1, "r1", 50);
    expect(acct.bagCents).toBeCloseTo(0.5, 10);
    expect(acct.ledger).toHaveLength(0);
    // Replay same refId — bag must stay 0.5 (NOT 1.0), no row, no balance change.
    simulateCharge(acct, "legacy", 1, "r1", 50);
    expect(acct.bagCents).toBeCloseTo(0.5, 10);
    expect(acct.ledger).toHaveLength(0);
    expect(acct.balanceCents).toBe(0);
  });
});

describe("D1 sub-cent — floor(bag) < 1 writes NO ledger row", () => {
  it("accumulates in the bag with no ledger row until it crosses 1c", () => {
    const acct = emptyAccount();
    simulateCharge(acct, "legacy", 1, "a", 50); // owed 0.5 → bag 0.5, no row
    expect(acct.ledger).toHaveLength(0);
    expect(acct.balanceCents).toBe(0);
    expect(acct.bagCents).toBeCloseTo(0.5, 10);
  });
});

describe("D1 bag crossing 1c — exactly one consumption row = balance decrement", () => {
  it("crossing 1c flushes one row, retains the remainder", () => {
    const acct = emptyAccount();
    simulateCharge(acct, "legacy", 1, "a", 50); // bag 0.5
    simulateCharge(acct, "legacy", 1, "b", 70); // owed 0.7 → total 1.2 → flush 1, remainder 0.2
    expect(acct.ledger).toHaveLength(1);
    expect(acct.ledger[0]?.deltaCents).toBe(-1);
    expect(acct.ledger[0]?.kind).toBe("consumption");
    // The consumption ledger ref_id is NAMESPACED `charge:<refId>` (mirrors the
    // engine) so it can never collide with a grant/legacy/allowance ref_id.
    expect(acct.ledger[0]?.refId).toBe("charge:b");
    expect(acct.balanceCents).toBe(-1); // decrement == flushed row
    expect(acct.bagCents).toBeCloseTo(0.2, 10);
    expect(acct.balanceCents).toBe(ledgerSum(acct));
  });
});

// ─── D4 wallet fuel gauge ────────────────────────────────────────────────────

describe("walletPercent — server-computed fuel gauge percent [0,100]", () => {
  it("full wallet at the reference anchor → 100", () => {
    expect(walletPercent(1000, 1000)).toBe(100);
  });
  it("half the reference → 50", () => {
    expect(walletPercent(500, 1000)).toBe(50);
  });
  it("empty balance → 0", () => {
    expect(walletPercent(0, 1000)).toBe(0);
    expect(walletPercent(-50, 1000)).toBe(0);
  });
  it("never funded (reference 0) → 0, never divide-by-zero", () => {
    expect(walletPercent(0, 0)).toBe(0);
    expect(walletPercent(100, 0)).toBe(0);
  });
  it("balance above the reference (fresh grant, not re-anchored) clamps to 100", () => {
    expect(walletPercent(2000, 1000)).toBe(100);
  });
  it("non-finite inputs → 0 (never throws / NaN)", () => {
    expect(walletPercent(Number.NaN, 1000)).toBe(0);
    expect(walletPercent(500, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("always returns an integer in [0,100]", () => {
    for (let b = -100; b <= 1200; b += 37) {
      const p = walletPercent(b, 1000);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
});
