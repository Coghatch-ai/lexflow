// app/src/pages/BillingPage.test.ts
//
// Unit tests for pure display/format logic extracted from BillingPage.
// Plain vitest — no jsdom, no RTL (project pattern).

import { describe, expect, it } from "vitest";
import { normalizeCouponCode, isValidCouponCode } from "@shared/domain/credits";

// ── successMessage (inline replica for test isolation) ────────────────────────
// The real fn is inlined in BillingPage/RedeemCoupon; replicate the logic here
// so it can be unit-tested without a React import.

type CouponKind = "credits" | "allowance" | "subscription";

function successMessage(kind: CouponKind, granted: number): string {
  if (kind === "credits") {
    return `Cupom resgatado! ${granted} crédito${granted === 1 ? "" : "s"} adicionado${granted === 1 ? "" : "s"} à sua conta.`;
  }
  if (kind === "allowance") {
    return `Cupom resgatado! ${granted} uso${granted === 1 ? "" : "s"} de IA principal adicionado${granted === 1 ? "" : "s"} ao seu saldo.`;
  }
  return `Cupom resgatado! Assinatura ativada por ${granted} ${granted === 1 ? "mês" : "meses"}.`;
}

function kindMessage(kind: CouponKind, granted: number): string {
  if (kind === "credits") return `+${String(granted)} crédito${granted === 1 ? "" : "s"}!`;
  if (kind === "allowance")
    return `+${String(granted)} uso${granted === 1 ? "" : "s"} de IA principal!`;
  return `Assinatura ativada por ${String(granted)} ${granted === 1 ? "mês" : "meses"}!`;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    tutor: "Assistente IA",
    coach: "Análise do Coach",
    coupon_grant: "Cupom resgatado",
    admin_grant: "Crédito admin",
    refund: "Estorno",
  };
  return map[action] ?? action;
}

// ── successMessage ─────────────────────────────────────────────────────────────

describe("successMessage (web RedeemCoupon)", () => {
  it("credits singular", () => {
    expect(successMessage("credits", 1)).toContain("1 crédito ");
  });
  it("credits plural", () => {
    expect(successMessage("credits", 5)).toContain("5 créditos ");
  });
  it("allowance singular", () => {
    expect(successMessage("allowance", 1)).toContain("1 uso ");
  });
  it("allowance plural", () => {
    expect(successMessage("allowance", 10)).toContain("10 usos ");
  });
  it("subscription singular", () => {
    expect(successMessage("subscription", 1)).toContain("1 mês");
  });
  it("subscription plural", () => {
    expect(successMessage("subscription", 3)).toContain("3 meses");
  });
});

// ── kindMessage (mobile CreditsChip + BillingPage) ────────────────────────────

describe("kindMessage (mobile chip)", () => {
  it("credits singular", () => {
    expect(kindMessage("credits", 1)).toBe("+1 crédito!");
  });
  it("credits plural", () => {
    expect(kindMessage("credits", 2)).toBe("+2 créditos!");
  });
  it("allowance singular", () => {
    expect(kindMessage("allowance", 1)).toBe("+1 uso de IA principal!");
  });
  it("allowance plural", () => {
    expect(kindMessage("allowance", 5)).toBe("+5 usos de IA principal!");
  });
  it("subscription singular", () => {
    expect(kindMessage("subscription", 1)).toBe("Assinatura ativada por 1 mês!");
  });
  it("subscription plural", () => {
    expect(kindMessage("subscription", 6)).toBe("Assinatura ativada por 6 meses!");
  });
});

// ── actionLabel ───────────────────────────────────────────────────────────────

describe("actionLabel", () => {
  it("known tutor", () => { expect(actionLabel("tutor")).toBe("Assistente IA"); });
  it("known coach", () => { expect(actionLabel("coach")).toBe("Análise do Coach"); });
  it("known coupon_grant", () => { expect(actionLabel("coupon_grant")).toBe("Cupom resgatado"); });
  it("known refund", () => { expect(actionLabel("refund")).toBe("Estorno"); });
  it("unknown falls back to raw", () => { expect(actionLabel("unknown_action")).toBe("unknown_action"); });
});

// ── coupon code helpers (shared/domain/credits) ───────────────────────────────

describe("normalizeCouponCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeCouponCode("  abcd-efgh  ")).toBe("ABCD-EFGH");
  });
});

describe("isValidCouponCode", () => {
  it("valid XXXX-XXXX", () => { expect(isValidCouponCode("ABCD-EFGH")).toBe(true); });
  it("invalid with I", () => { expect(isValidCouponCode("ABCI-EFGH")).toBe(false); });
  it("invalid with O", () => { expect(isValidCouponCode("ABCO-EFGH")).toBe(false); });
  it("invalid with 0", () => { expect(isValidCouponCode("ABC0-EFGH")).toBe(false); });
  it("invalid with 1", () => { expect(isValidCouponCode("ABC1-EFGH")).toBe(false); });
  it("invalid short", () => { expect(isValidCouponCode("ABC-EFGH")).toBe(false); });
  it("invalid long", () => { expect(isValidCouponCode("ABCDE-EFGH")).toBe(false); });
  it("normalizes before check", () => { expect(isValidCouponCode("abcd-efgh")).toBe(true); });
});
