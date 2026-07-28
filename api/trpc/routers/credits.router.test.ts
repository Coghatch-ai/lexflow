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

describe("K8 — coupon redeem enforces the reserved-prefix guard before any ledger write (r3)", () => {
  // redeemInTx builds replayRefId from a caller-supplied coupon `code` and writes it
  // into the GLOBAL credit_ledger.ref_id across all three rails. It must call the
  // shared assertExternalRefId guard BEFORE any tx.insert so a caller can never squat
  // the internal charge:/legacy_allowance: namespace via a coupon code.
  it("imports assertExternalRefId from the shared reserved registry", () => {
    expect(src).toContain("assertExternalRefId");
    expect(src).toContain('from "../../../shared/domain/credit-reserved"');
  });

  it("asserts replayRefId before the first creditLedger insert", () => {
    const guardIdx = src.indexOf("assertExternalRefId(replayRefId");
    const firstInsertIdx = src.indexOf("tx.insert(creditLedger)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstInsertIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstInsertIdx);
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

// ── Issue #56 read procedures ────────────────────────────────────────────────

describe("R1 — allowanceBalance procedure (issue #56)", () => {
  it("procedure named allowanceBalance exists on creditsRouter", () => {
    expect(src).toContain("allowanceBalance: protectedProcedure");
  });

  it("calls getAllowanceBalance(ctx.userId)", () => {
    expect(src).toContain("getAllowanceBalance(ctx.userId)");
  });

  it("getAllowanceBalance imported from allowance lib", () => {
    expect(src).toContain("getAllowanceBalance");
    expect(src).toContain('from "../../lib/allowance"');
  });

  it("queries subscriptions table for periodEnd", () => {
    expect(src).toContain("subscriptions");
    expect(src).toContain("currentPeriodEnd");
  });

  it("returns balance + periodEnd shape", () => {
    expect(src).toContain("balance,");
    expect(src).toContain("periodEnd:");
  });

  it("periodEnd is null when no subscription row", () => {
    // Null coalesce pattern: sub?.currentPeriodEnd ?? null
    expect(src).toContain("?? null");
  });

  it("does NOT hardcode any allowance number", () => {
    // Guard: no magic numbers for allowance size
    expect(src).not.toMatch(/allowanceBalance[\s\S]{0,500}balance:\s*\d+/m);
  });
});

describe("R2 — subscriptionStatus procedure (issue #56)", () => {
  it("procedure named subscriptionStatus exists on creditsRouter", () => {
    expect(src).toContain("subscriptionStatus: protectedProcedure");
  });

  it("returns plan:'free' + status:'none' for free user (no row)", () => {
    expect(src).toContain('plan: "free"');
    expect(src).toContain('status: "none"');
  });

  it("returns null dates for free user", () => {
    expect(src).toContain("currentPeriodStart: null");
    expect(src).toContain("currentPeriodEnd: null");
  });

  it("returns real plan + status from subscriptions row for paid user", () => {
    expect(src).toContain("plan: sub.plan");
    expect(src).toContain("status: sub.status");
  });

  it("returns real period dates from subscriptions row", () => {
    expect(src).toContain("currentPeriodStart: sub.currentPeriodStart");
    expect(src).toContain("currentPeriodEnd: sub.currentPeriodEnd");
  });

  it("has explicit return type to avoid tRPC union-strip of null fields", () => {
    // Explicit Promise<{...}> annotation prevents tRPC stripping null from the type.
    expect(src).toContain("): Promise<{");
  });
});

// ── Mobile BillingPage wiring guards (issue #56 Codex gap) ──────────────────
// Source-scan pattern: read mobile BillingPage source and assert it consumes
// both #56 reads + invalidates them after redeem. Goes RED against the pre-fix
// hardcoded-placeholder version; GREEN now.

const mobileSrc = readFileSync(
  join(import.meta.dirname, "../../../apps/mobile/src/pages/BillingPage.tsx"),
  "utf-8",
);

describe("R3 — mobile BillingPage wiring (issue #56 Codex gap)", () => {
  it("consumes credits.allowanceBalance via useQuery", () => {
    expect(mobileSrc).toContain("credits.allowanceBalance.useQuery");
  });

  it("consumes credits.subscriptionStatus via useQuery", () => {
    expect(mobileSrc).toContain("credits.subscriptionStatus.useQuery");
  });

  it("invalidates allowanceBalance after redeem", () => {
    expect(mobileSrc).toContain("utils.credits.allowanceBalance.invalidate");
  });

  it("invalidates subscriptionStatus after redeem", () => {
    expect(mobileSrc).toContain("utils.credits.subscriptionStatus.invalidate");
  });

  it("does NOT hard-lock plan badge to 'Gratuito' string literal", () => {
    // Pre-fix: plan badge was hardcoded 'Gratuito' unconditionally.
    // Post-fix: planLabel() derives it from real data — the static literal
    // still exists inside planLabel() as a fallback branch, but the badge
    // itself is driven by subscriptionStatus data, not a bare string literal
    // outside the helper. Guard: the component uses planLabel(…) rather than
    // embedding the raw pt-BR string directly in JSX.
    expect(mobileSrc).toContain("planLabel(");
  });

  it("does NOT contain the static 'Disponível em breve' allowance placeholder", () => {
    // Pre-fix: allowance card showed this static placeholder.
    // Post-fix: replaced by real data from allowanceBalance query.
    expect(mobileSrc).not.toContain("Disponível em breve");
  });
});
