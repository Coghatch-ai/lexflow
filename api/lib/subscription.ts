// api/lib/subscription.ts
//
// Subscription grant paths (S6, issue #53). Activates a paid subscription
// period for a user via coupon redemption or admin action. No payment gateway —
// coupons + admin are the only grant paths this build.
//
// Grant logic:
//   1. Insert a zero-cents sentinel grant into the unified ledger (cents=0,
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

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { subscriptions } from "../../drizzle/schema";
import { grantAllowance } from "./allowance";
import { grant, type CreditTx } from "./credit-charge";
import { getConfigNumber, CONFIG_KEYS } from "./pricing-config";
import { PLAN_PAID } from "../../shared/domain/allowance";

// Executor type — the money-core writers + the raw SQL here all run on the SAME
// transaction. CreditTx (a drizzle tx) satisfies both `.execute`/`.insert` and the
// money core's tx param, so a single type flows through the whole grant chain.
type DbOrTx = CreditTx;

/**
 * Stable 32-bit unsigned integer derived from (userId, namespace) via djb2 — the
 * pg_advisory_xact_lock key. Different namespaces yield different keys so unrelated
 * per-user locks do not needlessly block each other. Returns a safe JS number
 * (max 2^32-1 < Number.MAX_SAFE_INTEGER). Local to this file (the last advisory-lock
 * user after the no-legacy cutover removed the spend rails).
 */
export function hashLockKey(userId: string, namespace: string): number {
  const str = `${userId}|${namespace}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash;
}

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
  // Per-user advisory lock — serializes concurrent grants for the same user,
  // including the first-grant case where no subscriptions row exists yet.
  // FOR UPDATE below only locks an EXISTING row; when two distinct-key grants
  // race on a new user both sentinel inserts succeed (keyed by idempotencyKey,
  // not userId), both SELECT FOR UPDATE lock zero rows, and both compute the
  // same periodStart → second write overwrites the first extension. The
  // advisory lock prevents this: the second concurrent grant blocks here until
  // the first commits, then sees the updated current_period_end and extends
  // forward correctly. The "subscription" namespace is unique to this file (the
  // last advisory-lock user after the no-legacy cutover removed the spend rails).
  const subLockKey = hashLockKey(userId, "subscription");
  await executor.execute(sql`SELECT pg_advisory_xact_lock(${subLockKey})`);

  // F3 sentinel — a zero-cents grant() into the UNIFIED credit_ledger BEFORE
  // touching the subscription row (the money core is the ONLY ledger writer, so the
  // sentinel is a core write too). grant() is idempotent by ref_id: applied=false
  // means the key was already committed → this is a retry → short-circuit before the
  // period extension.
  //
  // The sentinel refId `sub:sentinel:<key>` is DISTINCT from the real allowance
  // top-up refId (`<key>`), so the sentinel never shadows the grant. cents=0 keeps
  // the balance unchanged (marker only). source=subscription groups it with the
  // grant it guards.
  const sentinelRefId = `sub:sentinel:${idempotencyKey}`;
  const sentinel = await grant({
    scope: { userId },
    cents: 0,
    source: "subscription",
    refId: sentinelRefId,
    kind: "grant",
    tx: executor,
  });

  // Not applied → key already used → this is a retry; do nothing.
  if (!sentinel.applied) {
    return;
  }

  // First occurrence of the key — proceed with the period extension.

  // Derive periodStart from max(existing current_period_end, now) so repeated
  // grants with DIFFERENT keys extend forward rather than resetting to now.
  //
  // FOR UPDATE: serializes concurrent distinct-key grants for the same user.
  // Without this, two concurrent grants both read the same current_period_end,
  // compute the same periodStart, and write the same period (one extension lost).
  // The lock is valid here because grantSubscriptionImpl always runs inside a
  // transaction (db.transaction wrapper in standalone path; caller tx in coupon
  // path) — FOR UPDATE requires an active transaction to hold the lock.
  // First-grant path (no row yet) is already serialized by the sentinel unique
  // insert above; FOR UPDATE only matters when a row already exists.
  const existingResult = await executor.execute(sql`
    SELECT current_period_end
    FROM subscriptions
    WHERE user_id = ${userId}::uuid
    LIMIT 1
    FOR UPDATE
  `);
  const existing = (existingResult.rows as Array<{ current_period_end: string | null }>)[0];

  const now = new Date();
  let periodStart: Date;
  if (existing?.current_period_end != null) {
    const existingEnd = new Date(existing.current_period_end);
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
