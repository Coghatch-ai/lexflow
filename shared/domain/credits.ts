// shared/domain/credits.ts
//
// Pay-as-you-go credits: the user buys credits and each AI action debits a
// fixed amount. The ledger (credit_ledger) is the single source of truth —
// balance = SUM(delta). Failed relay jobs are refunded idempotently.
//
// Costs are RATIOS anchored to the measured real cost per action on
// gpt-5.4-mini (tutor ~0.23¢, coach ~0.29¢ — cost model on issue #48):
// near-equal real cost, so near-equal credit cost. The BRL price per credit
// is a pack-pricing decision made at purchase-flow time (aggressive pricing,
// thin margin — owner directive), NOT hardcoded here.
//
// NOTE: `grade` (phase-2 discursive grading) was REMOVED from credits in S3
// (#52) — it now draws the allowance_ledger (core AI action). Only non-core
// actions live here: tutor (per-question buddy) + coach (weak-point analysis).

export const CREDIT_COSTS = {
  tutor: 1,
  coach: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

// Ledger action tags beyond spends. NO signup grant — an automatic signup
// grant is farmable (delete account → re-register → fresh users.id → another
// grant, unbounded; maggie issue #126). Coupons are the only free-credit path.
// `grade` was removed from CreditAction in S3 (#52); it now uses AllowanceAction.
export type LedgerAction = CreditAction | "coupon_grant" | "admin_grant" | "refund";

// Human-typeable coupon code: XXXX-XXXX from an alphabet without lookalikes
// (no I/O/0/1). Same format as maggie #126.
export const COUPON_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const COUPON_CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidCouponCode(raw: string): boolean {
  return COUPON_CODE_REGEX.test(normalizeCouponCode(raw));
}
