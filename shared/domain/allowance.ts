// shared/domain/allowance.ts
//
// Subscription plan codes after the no-legacy cutover (D4, epic #50). "Allowance"
// is no longer a separate currency — it is `source=subscription` grants in the ONE
// unified ledger. The old per-action allowance cost constant, the free-tier daily
// limit constant, and the allowance rail action tags are DELETED. Only the plan LOV
// codes (stored in subscriptions.plan) remain here.

// Subscription plan codes stored in subscriptions.plan (LOV-keyed).
export const PLAN_FREE = "free" as const;
export const PLAN_PAID = "paid" as const;
