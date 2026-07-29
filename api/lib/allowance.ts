// api/lib/allowance.ts
//
// Allowance GRANT helper after the no-legacy cutover (D4, epic #50). "Allowance"
// is no longer a separate rail/currency — it is simply `source=subscription` grants
// in the ONE unified ledger (credit_balances/credit_ledger). The old
// debit-at-admission rail (its assert/debit helpers, its per-user ledger table, and
// the free-tier daily counter table) was DELETED in D4: admission reads the unified
// balance (api/lib/admission.ts) and spend settles post-delivery through charge()
// (api/lib/ai-metering.ts).
//
// The only thing left here is the positive grant, routed through the single writer
// grant(). Subscription monthly grants, coupon allowance top-ups, and admin
// top-ups all fund the same `source=subscription` entitlement, so its reset knobs
// (rollover.subscription / expiry_months.subscription) key off this one source.

import { grant, type CreditTx } from "./credit-charge";

// The unified-ledger `source` every allowance grant maps to.
const ALLOWANCE_SOURCE = "subscription" as const;

/**
 * Idempotent positive allowance grant (admin / coupon / monthly), routed through
 * the money core grant() writer (kind=grant, source=subscription). The unified
 * credit_ledger + credit_balances are updated in one tx by the single writer;
 * reference_cents (the wallet-gauge anchor) is snapshotted on this positive
 * money-in. Units map 1:1 to cents.
 *
 * @param tx - optional transaction executor. When redeeming a coupon, pass the
 *   active drizzle transaction so the grant joins the same atomic unit as the
 *   coupon cap increment. Standalone callers (admin grant, subscription
 *   activation) omit this and the core opens its own transaction.
 */
export async function grantAllowance(
  userId: string,
  units: number,
  _action: "monthly_grant" | "top_up" | "rollover" | "admin_grant",
  refId: string,
  _note?: string,
  tx?: CreditTx,
): Promise<void> {
  await grant({
    scope: { userId },
    cents: units,
    source: ALLOWANCE_SOURCE,
    // Namespace the unified ledger ref_id so a coupon/admin refId can never collide
    // with another writer's key on the global ledger unique index.
    refId: `allowance_grant:${refId}`,
    kind: "grant",
    tx,
  });
}
