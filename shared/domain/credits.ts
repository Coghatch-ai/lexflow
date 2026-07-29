// shared/domain/credits.ts
//
// Credit domain — coupon code helpers only, after the no-legacy cutover (D4, epic
// #50). There is ONE unified money engine now (credit_balances/credit_ledger,
// written solely by api/lib/credit-charge.ts). The old fixed per-action price table
// is DELETED: spend cost is the measured cost-of-goods
// (shared/domain/cost-of-goods.ts) × the per-source multiplier (credit_config),
// metered post-delivery — never a hardcoded per-action price. Coupons remain the
// only free-credit path (an automatic signup grant is farmable; maggie #126).

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
