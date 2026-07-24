// shared/domain/coupons.ts
//
// Coupon kind type and constants (S4, issue #53).
// Shared between frontend + backend; no server-only imports here.

export const COUPON_KINDS = ["credits", "allowance", "subscription"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];
