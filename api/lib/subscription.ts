// api/lib/subscription.ts
//
// Subscription grant paths (S6, issue #53). Activates a paid subscription
// period for a user via coupon redemption or admin action. No payment gateway —
// coupons + admin are the only grant paths this build.
//
// Grant logic:
//   1. Insert a sentinel row into allowance_ledger (delta=0,
//      refId=`sub:sentinel:<idempotencyKey>`) BEFORE mutating the subscription row.
//      The unique ref_id index makes this insert a no-op (onConflictDoNothing) on
//      retry — short-circuit: skip the subscription upsert and allowance top-up.
//      Only the FIRST call with a given key proceeds past this point.
//   2. Read the existing subscriptions row (if any) to derive the correct
//      period start: max(current_period_end, now). This ensures repeated grants
//      extend forward from the last known end rather than resetting to now.
//   3. Upsert the subscriptions row (plan='paid', status='active', period dates).
//   4. Grant the monthly allowance for the new period via grantAllowance
//      (action='monthly_grant', refId=idempotencyKey — no prefix, distinct from sentinel).
//
// Idempotency (F3 fix, Codex review:changes, issue #53):
//   - The sentinel refId is `sub:sentinel:<key>` (step 1).
//   - The real allowance grant refId is `<key>` (step 4, no prefix).
//   - These MUST differ: if both used the same ref_id the allowance insert would
//     hit onConflictDoNothing on the first call (sentinel already owns that key)
//     and the subscriber would receive zero allowance. (QA blocker fixed here.)
//   - On retry the sentinel insert returns 0 rows → short-circuit before the
//     subscription upsert → currentPeriodEnd unchanged, no allowance stack.
//   - Coupon redeem uses `coupon:<code>:<userId>` as idempotencyKey.
//   - Admin grant uses `sub:admin:<userId>:<uuid>` (caller-generated UUID).
//   - Period start is derived from max(existing current_period_end, now) so
//     repeated grants with DIFFERENT keys extend the period instead of stacking.
//
// Period: currentPeriodStart = max(existingEnd, now); currentPeriodEnd = start + N months.
// Anniversary reset (rollover/expire) is handled by S3's spend engine — out of
// scope here (this file only activates/extends the period).

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { allowanceLedger, subscriptions } from "../../drizzle/schema";
import { grantAllowance } from "./allowance";
import { getConfigNumber, CONFIG_KEYS } from "./pricing-config";
import { PLAN_PAID } from "../../shared/domain/allowance";

// Minimal executor type — same subset used by grantAllowance.
type DbOrTx = Pick<typeof db, "insert" | "select" | "update">;

/**
 * Internal implementation — all writes take a required executor so every
 * caller path is transactional. The public `grantSubscription` wraps this
 * in `db.transaction()` when no outer tx is supplied (admin path), or
 * passes the caller's tx through unchanged (coupon redeem path). This
 * avoids nesting a transaction inside an existing one.
 *
 * The config read (`getConfigNumber`) is intentionally done BEFORE the
 * transaction wrapping call so a DB I/O error there does not leave a
 * partially-committed sentinel. It is a read-only query and does not need
 * to be inside the atomic write set.
 */
async function grantSubscriptionImpl(
  userId: string,
  periodMonths: number,
  idempotencyKey: string,
  units: number,
  note: string | undefined,
  executor: DbOrTx,
): Promise<void> {
  // F3 sentinel — insert a zero-delta allowance_ledger row BEFORE touching the
  // subscription row. The unique ref_id index makes this a no-op (0 rows inserted)
  // on retry. When 0 rows come back the key was already committed → short-circuit.
  //
  // IMPORTANT: the sentinel refId is namespaced as `sub:sentinel:<idempotencyKey>`
  // so it does NOT collide with the real allowance top-up below, which uses
  // `refId = idempotencyKey` (no prefix). Without the namespace both writes share
  // the same ref_id → top-up hits onConflictDoNothing on first call → subscriber
  // gets zero allowance. The namespace keeps them distinct:
  //   sentinel row  → refId = "sub:sentinel:<key>"  delta=0
  //   allowance row → refId = "<key>"               delta=units
  const sentinelRefId = `sub:sentinel:${idempotencyKey}`;
  const sentinelResult = await executor
    .insert(allowanceLedger)
    .values({
      userId,
      delta: 0,
      action: "monthly_grant",
      refId: sentinelRefId,
      note: `sentinel:subscription_grant`,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: allowanceLedger.refId })
    .returning({ id: allowanceLedger.id });

  // 0 rows → key already used → this is a retry; do nothing.
  if (sentinelResult.length === 0) {
    return;
  }

  // First occurrence of the key — proceed with the period extension.

  // Derive periodStart from max(existing current_period_end, now) so repeated
  // grants with DIFFERENT keys extend forward rather than resetting to now.
  const [existing] = await executor
    .select({ currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const now = new Date();
  let periodStart: Date;
  if (existing?.currentPeriodEnd != null) {
    const existingEnd = new Date(existing.currentPeriodEnd);
    periodStart = existingEnd > now ? existingEnd : now;
  } else {
    periodStart = now;
  }

  const periodStartIso = periodStart.toISOString();

  // Compute periodEnd = periodStart + periodMonths calendar months.
  const endDate = new Date(periodStart);
  endDate.setMonth(endDate.getMonth() + periodMonths);
  const periodEnd = endDate.toISOString();

  // 1. Upsert subscriptions row. ON CONFLICT (user_id) updates the period + status.
  await executor
    .insert(subscriptions)
    .values({
      userId,
      plan: PLAN_PAID,
      status: "active",
      currentPeriodStart: periodStartIso,
      currentPeriodEnd: periodEnd,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        plan: PLAN_PAID,
        status: "active",
        currentPeriodStart: periodStartIso,
        currentPeriodEnd: periodEnd,
        lastUpdAt: sql`now()`,
        lastUpdBy: userId,
      },
    });

  // 2. Grant the monthly allowance for this period.
  //    refId = idempotencyKey — defence-in-depth; sentinel at step 0 already guards.
  if (units > 0) {
    await grantAllowance(
      userId,
      units,
      "monthly_grant",
      idempotencyKey,
      note ?? `subscription grant (${String(periodMonths)}mo)`,
      executor,
    );
  }
}

/**
 * Activate (or extend) a paid subscription for `userId`.
 *
 * @param userId          - the user to grant the subscription to
 * @param periodMonths    - subscription length in calendar months (>= 1)
 * @param idempotencyKey  - caller-supplied key that dedupes the allowance grant.
 *                          Coupon redeem passes `coupon:<code>:<userId>`;
 *                          admin grant passes `sub:admin:<userId>:<uuid>`.
 * @param note            - optional provenance note stored on allowance row
 * @param tx              - optional transaction executor. When absent (admin grant
 *                          path), the entire write chain (sentinel → select →
 *                          subscription upsert → allowance top-up) runs inside a
 *                          fresh `db.transaction()`. When present (coupon redeem),
 *                          the caller's transaction is reused — no nesting.
 *
 * Throws when periodMonths < 1 (caller validation expected; this is a hard guard).
 * Does NOT throw when monthly_allowance_units is unset — grants 0 units instead,
 * since the subscription itself has value even with no allowance seeded yet.
 * The real-cost guard (requireRealCostPerUnit) is on price-serving endpoints,
 * not on grant paths.
 */
export async function grantSubscription(
  userId: string,
  periodMonths: number,
  idempotencyKey: string,
  note?: string,
  tx?: DbOrTx,
): Promise<void> {
  if (!Number.isInteger(periodMonths) || periodMonths < 1) {
    throw new Error(`grantSubscription: periodMonths must be >= 1, got ${String(periodMonths)}`);
  }

  // Read config BEFORE opening the transaction: this is a read-only query;
  // keeping it outside the write set means a config-read error never leaves
  // a partial sentinel committed.
  const units = (await getConfigNumber(CONFIG_KEYS.MONTHLY_ALLOWANCE_UNITS)) ?? 0;

  if (tx !== undefined) {
    // Coupon-redeem path: caller already holds a transaction — reuse it directly
    // so sentinel + subscription upsert + allowance top-up all join that same tx.
    // Do NOT open a nested db.transaction() here.
    await grantSubscriptionImpl(userId, periodMonths, idempotencyKey, units, note, tx);
  } else {
    // Standalone/admin path: no outer tx. Wrap the entire write chain in a fresh
    // transaction so a mid-chain failure (e.g. allowance top-up throws) rolls back
    // the sentinel insert and the subscription upsert atomically.
    await db.transaction(async (innerTx) => {
      await grantSubscriptionImpl(userId, periodMonths, idempotencyKey, units, note, innerTx);
    });
  }
}
