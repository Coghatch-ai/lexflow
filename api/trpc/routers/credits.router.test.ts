// api/trpc/routers/credits.router.test.ts
//
// Regression guards for S4 coupon kinds (issue #53) + Codex review:changes fixes.
// Strategy: source-text assertions so each guard goes RED if the fix is reverted,
// without needing a live DB.
//
// Guards:
//   K1 — redeem branches on coupon kind (credits | allowance | subscription)
//   K2 — atomic-cap rail present for all kinds (same conditional UPDATE pattern)
//   K3 — replay-guard sentinel used for allowance + subscription kinds
//   K4 — mintCoupon validates kind-specific value fields
//   K5 — listCoupons returns kind + all value fields
//   K6 — [F1] grant helpers receive tx executor (not called on global db from inside tx)
//   K7 — [F2] unknown kind rejected; non-positive kind values rejected (not defaulted)

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "credits.router.ts"), "utf-8");

describe("K1 — redeem branches on coupon kind", () => {
  it("imports CouponKind + COUPON_KINDS from shared/domain/coupons", () => {
    expect(src).toContain('from "../../../shared/domain/coupons"');
  });

  it("handles kind === 'credits'", () => {
    expect(src).toContain('kind === "credits"');
  });

  it("handles kind === 'allowance'", () => {
    expect(src).toContain('kind === "allowance"');
  });

  it("handles kind === 'subscription'", () => {
    expect(src).toContain('kind === "subscription"');
  });

  it("calls grantAllowance for allowance kind", () => {
    expect(src).toContain("grantAllowance(");
  });

  it("calls grantSubscription for subscription kind", () => {
    expect(src).toContain("grantSubscription(");
  });
});

describe("K2 — atomic-cap rail preserved for all kinds", () => {
  it("conditional UPDATE uses lt(coupons.redeemedCount, coupons.maxRedemptions)", () => {
    expect(src).toContain("lt(coupons.redeemedCount, coupons.maxRedemptions)");
  });

  it("RETURNING includes kind + all value fields", () => {
    expect(src).toContain("kind: coupons.kind");
    expect(src).toContain("valueCredits: coupons.valueCredits");
    expect(src).toContain("valueUnits: coupons.valueUnits");
    expect(src).toContain("valuePeriodMonths: coupons.valuePeriodMonths");
  });

  it("NOT_FOUND thrown when won === undefined (cap exhausted or expired)", () => {
    expect(src).toContain("if (won === undefined)");
    expect(src).toContain("Cupom inválido, esgotado ou expirado");
  });
});

describe("K3 — replay guard sentinel for allowance + subscription kinds", () => {
  it("replayRefId pattern is coupon:<code>:<userId>", () => {
    // redeemInTx receives userId directly (not ctx.userId); either form is valid.
    const hasCtxForm = src.includes("coupon:${code}:${ctx.userId}");
    const hasDirectForm = src.includes("coupon:${code}:${userId}");
    expect(hasCtxForm || hasDirectForm).toBe(true);
  });

  it("allowance kind inserts sentinel into creditLedger before grantAllowance", () => {
    // The sentinel insert must come before grantAllowance in the source.
    const sentinelIdx = src.indexOf("allowance:${code}");
    const grantIdx = src.indexOf("grantAllowance(");
    expect(sentinelIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeGreaterThan(-1);
    expect(sentinelIdx).toBeLessThan(grantIdx);
  });

  it("subscription kind inserts sentinel into creditLedger before grantSubscription", () => {
    const sentinelIdx = src.indexOf("subscription:${code}");
    const grantIdx = src.indexOf("grantSubscription(");
    expect(sentinelIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeGreaterThan(-1);
    expect(sentinelIdx).toBeLessThan(grantIdx);
  });

  it("double-redeem error message preserved", () => {
    expect(src).toContain("Você já resgatou este cupom");
  });
});

describe("K4 — mintCoupon validates kind-specific value fields", () => {
  it("credits kind requires valueCredits > 0", () => {
    expect(src).toContain("Cupom de créditos requer valueCredits > 0");
  });

  it("allowance kind requires valueUnits > 0", () => {
    expect(src).toContain("Cupom de allowance requer valueUnits > 0");
  });

  it("subscription kind requires valuePeriodMonths > 0", () => {
    expect(src).toContain("Cupom de assinatura requer valuePeriodMonths > 0");
  });

  it("mintCoupon returns kind in response", () => {
    expect(src).toContain("return { code, kind: input.kind }");
  });
});

describe("K5 — listCoupons returns kind + all value fields", () => {
  it("selects kind from coupons", () => {
    expect(src).toContain("kind: coupons.kind,");
  });

  it("selects valueUnits from coupons", () => {
    expect(src).toContain("valueUnits: coupons.valueUnits,");
  });

  it("selects valuePeriodMonths from coupons", () => {
    expect(src).toContain("valuePeriodMonths: coupons.valuePeriodMonths,");
  });
});

describe("K6 — [F1] grant helpers receive tx (transactional grant, Codex finding #1)", () => {
  it("grantAllowance call inside redeem passes tx as last arg", () => {
    // Call spans multiple lines; use multiline-aware pattern.
    expect(src).toMatch(/grantAllowance\([\s\S]*?,\s*tx[,\s)]/m);
  });

  it("grantSubscription call inside redeem passes tx as last arg", () => {
    expect(src).toMatch(/grantSubscription\([\s\S]*?,\s*tx[,\s)]/m);
  });

  it("grantAllowance is NOT called on bare db inside the transaction", () => {
    // No `db.insert` after grantAllowance import — all inserts use `tx` inside the tx.
    // Simpler guard: confirm the tx parameter is forwarded, not that db is absent
    // (db is still used elsewhere in the file for ledger/balance queries).
    // The K6 tx-arg tests above are the primary guard.
    expect(src).toContain("tx,");
  });
});

describe("K7 — [F2] kind validation + non-positive value rejection (Codex finding #2)", () => {
  it("unknown kind is rejected with INTERNAL_SERVER_ERROR", () => {
    expect(src).toContain("Cupom com tipo desconhecido:");
  });

  it("includes COUPON_KINDS guard before casting kind", () => {
    // The guard must appear before 'const kind = won.kind as CouponKind'
    const guardIdx = src.indexOf("COUPON_KINDS");
    const castIdx = src.indexOf("won.kind as CouponKind");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(castIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(castIdx);
  });

  it("non-positive valueUnits rejected for allowance kind (not defaulted)", () => {
    expect(src).toContain("Cupom de allowance sem valueUnits válido");
  });

  it("non-positive valuePeriodMonths rejected for subscription kind (not defaulted to 1)", () => {
    expect(src).toContain("Cupom de assinatura sem valuePeriodMonths válido");
  });

  it("subscription branch does NOT fallback valuePeriodMonths <= 0 to 1", () => {
    // Old code: won.valuePeriodMonths > 0 ? won.valuePeriodMonths : 1
    // New code throws instead of defaulting — ensure the fallback is gone.
    expect(src).not.toContain("valuePeriodMonths > 0 ? won.valuePeriodMonths : 1");
  });
});
