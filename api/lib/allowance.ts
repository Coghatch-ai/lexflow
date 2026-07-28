// api/lib/allowance.ts
//
// Allowance ledger operations for CORE AI actions (phase-1 explanation +
// phase-2 grading). Mirrors the money-shaped invariants of credits.ts:
//   - balance = SUM(delta); never stored, never trusted from the client.
//   - every spend/refund carries a unique ref_id (jobId / refund:<jobId>)
//     so retries can never double-apply (DB unique index enforces).
//   - spend order: assertCoreAction → debitAllowance(refId=jobId) → enqueue relay
//     (debit-before-enqueue; the debit is the cost-commit point, reversed via
//     refundAllowance if the enqueue throws). PAID path only — free path must NOT
//     write allowance_ledger rows.
//   - refunds fire from relay.job on status:error, idempotent (onConflictDoNothing).
//
// Free-tier gate: free users (no active paid subscription) are limited to
// FREE_TIER_DAILY_LIMIT core uses per calendar day (America/Sao_Paulo).
// The claim is ATOMIC — a single conditional upsert that only succeeds when
// count < LIMIT; the returned row signals success. This prevents race-bypass.
// Subscribers bypass the counter and go straight to the allowance balance.
//
// Free-tier consumption NEVER touches allowance_ledger (F3 fix). A user who
// later subscribes starts with a clean paid balance — no historical free debits.
//
// Spend routing (enforced here and in the routers):
//   Core + paid  → allowance_ledger (this file)
//   Core + free  → free_daily_counter only (no allowance_ledger row)
//   Non-core     → credit_ledger (api/lib/credits.ts) — DO NOT cross rails.

import { and, eq, sql, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { allowanceLedger, freeDailyCounter, subscriptions } from "../../drizzle/schema";
import { atomicDebitAllowance } from "./ledger-debit";

// Minimal executor type accepted by grantAllowance when called inside a
// transaction. drizzle node-postgres transactions expose the same .insert()
// interface as the global db — we only need the subset used here.
type DbOrTx = Pick<typeof db, "insert" | "select" | "update">;

import { ALLOWANCE_COST, FREE_TIER_DAILY_LIMIT, PLAN_PAID } from "../../shared/domain/allowance";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ISO date string for today in America/Sao_Paulo (YYYY-MM-DD). */
function spDay(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // sv-SE = ISO date format
}

/** True when the user has an active paid subscription. */
async function hasPaidSubscription(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row?.plan === PLAN_PAID && row.status === "active";
}

// ── Balance ───────────────────────────────────────────────────────────────────

export async function getAllowanceBalance(userId: string): Promise<number> {
  // Only sum rows that were written by the PAID path (action != 'free_use').
  // Free-tier consumption must never touch this table, so this SUM reflects
  // only paid grants and paid spends — free history does not poison the balance.
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${allowanceLedger.delta}), 0)::int` })
    .from(allowanceLedger)
    .where(eq(allowanceLedger.userId, userId));
  return row?.balance ?? 0;
}

// ── Free-tier counter ─────────────────────────────────────────────────────────

/**
 * Atomic free-tier claim. Uses a conditional upsert so the check-and-increment
 * is a single DB round-trip — no SELECT then later UPDATE race window (F1 fix).
 *
 * Returns the updated count when the claim succeeds (count was < LIMIT before
 * this call). Returns null when the day's limit was already reached — the
 * caller must throw FORBIDDEN in that case.
 *
 * The jobId is stored in last_job_id so the claim can be reversed idempotently
 * on relay failure (F2 fix).
 */
async function claimFreeTierCounter(userId: string, jobId: string): Promise<number | null> {
  const today = spDay();

  // Strategy: INSERT the first row (count=1) or UPDATE existing row only when
  // count < FREE_TIER_DAILY_LIMIT. The WHERE clause on the conflict target makes
  // the UPDATE a no-op (0 rows) when limit is already reached. RETURNING lets us
  // detect success vs. failure without a second round-trip.
  //
  // Drizzle's onConflictDoUpdate does not support a WHERE predicate on the SET,
  // so we use raw sql for the guarded update expression.
  const result = await db
    .insert(freeDailyCounter)
    .values({
      userId,
      day: today,
      count: 1,
      lastJobId: jobId,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoUpdate({
      target: [freeDailyCounter.userId, freeDailyCounter.day],
      // setWhere: the UPDATE only fires when count < LIMIT.
      // When limit already reached, the UPDATE matches 0 rows → RETURNING yields nothing
      // → result[0] is undefined → we return null (claim failed).
      // This is the real atomic guard: no CASE expression leaking a row on exhaustion.
      set: {
        count: sql`${freeDailyCounter.count} + 1`,
        lastJobId: sql`${jobId}::uuid`,
        lastUpdAt: sql`now()`,
        lastUpdBy: userId,
      },
      setWhere: sql`${freeDailyCounter.count} < ${FREE_TIER_DAILY_LIMIT}`,
    })
    .returning({ count: freeDailyCounter.count });

  const claimed = result[0];
  // No row returned → UPDATE predicate (count < LIMIT) was false → limit already reached.
  if (claimed === undefined) return null;
  return claimed.count;
}

/**
 * Reverse a free-tier claim by jobId. Idempotent: only decrements when
 * last_job_id matches — a second call finds last_job_id already cleared → no-op.
 * Called from relay.router when the relay job returns status:error (F2 fix).
 */
export async function reverseFreeTierCounter(userId: string, jobId: string): Promise<void> {
  const today = spDay();
  await db
    .update(freeDailyCounter)
    .set({
      count: sql`GREATEST(${freeDailyCounter.count} - 1, 0)`,
      lastJobId: null,
      lastUpdAt: sql`now()`,
      lastUpdBy: userId,
    })
    .where(
      and(
        eq(freeDailyCounter.userId, userId),
        eq(freeDailyCounter.day, today),
        eq(freeDailyCounter.lastJobId, jobId),
      ),
    );
}

// ── Allowance spend/refund ─────────────────────────────────────────────────────

/**
 * For PAID subscribers: throw FORBIDDEN when allowance balance < ALLOWANCE_COST.
 * (Free users are gated by the atomic counter, not this.)
 * Call BEFORE enqueueing the relay job.
 */
export async function assertAllowance(userId: string): Promise<void> {
  const balance = await getAllowanceBalance(userId);
  if (balance < ALLOWANCE_COST) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Saldo de IA insuficiente. Adquira mais allowance para continuar usando as funcionalidades principais.",
    });
  }
}

/**
 * Full core-action entitlement check. Call BEFORE enqueueing relay job.
 * - Free user  → atomic daily counter claim (throws FORBIDDEN if exhausted; F1 fix)
 * - Paid user  → allowance balance check (throws FORBIDDEN if exhausted; buy-more path)
 *
 * For free users, the jobId is required so the claim can be reversed on failure.
 * Returns tier so the caller knows whether to call debitAllowance (paid only).
 *
 * IMPORTANT: free path does NOT call debitAllowance. Callers must gate
 * debitAllowance on `tier === "paid"` to avoid poisoning the paid balance (F3 fix).
 */
export async function assertCoreAction(userId: string, jobId: string): Promise<"free" | "paid"> {
  const paid = await hasPaidSubscription(userId);
  if (paid) {
    await assertAllowance(userId);
    return "paid";
  }

  // Free path: atomic claim (F1 fix — no separate SELECT then increment).
  const claimed = await claimFreeTierCounter(userId, jobId);
  if (claimed === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Você atingiu o limite diário de uso de IA no plano gratuito. Aguarde o próximo dia ou adquira um plano.",
    });
  }
  return "free";
}

/** Record the allowance spend for an enqueued job. Atomic guarded debit via
 * atomicDebitAllowance: inserts ONLY when balance >= ALLOWANCE_COST (balance
 * guard in WHERE clause). Idempotent via ref_id unique index (replay = no-op).
 * Throws FORBIDDEN when balance is insufficient (guard fires, 0 rows returned).
 * MUST only be called for PAID users — free-tier spends must NOT write this table (F3 fix). */
export async function debitAllowance(userId: string, refId: string): Promise<void> {
  await atomicDebitAllowance(userId, refId);
}

/**
 * Refund a failed job's allowance spend. Looks up the original spend row to
 * mirror its amount; no-op when the spend doesn't exist or refund already applied.
 * Called from relay.router when a job returns status:error.
 * Only fires for paid-path jobs (free-path never writes allowance_ledger).
 */
export async function refundAllowance(userId: string, jobId: string): Promise<void> {
  const [spend] = await db
    .select({ delta: allowanceLedger.delta })
    .from(allowanceLedger)
    .where(
      and(
        eq(allowanceLedger.userId, userId),
        eq(allowanceLedger.refId, jobId),
        lt(allowanceLedger.delta, 0),
      ),
    )
    .limit(1);
  if (spend === undefined) return;
  await db
    .insert(allowanceLedger)
    .values({
      userId,
      delta: -spend.delta,
      action: "refund",
      refId: `refund:${jobId}`,
      note: "spend",
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: allowanceLedger.refId });
}

/**
 * Idempotent positive allowance grant (admin / coupon / monthly). refId dedupes replays.
 *
 * @param tx - optional transaction executor. When redeeming a coupon, pass the
 *   active drizzle transaction so the insert joins the same atomic unit as the
 *   coupon cap increment and replay-guard sentinel. Standalone callers (admin
 *   grant, subscription activation) omit this and use the module-level db.
 */
export async function grantAllowance(
  userId: string,
  units: number,
  action: "monthly_grant" | "top_up" | "rollover" | "admin_grant",
  refId: string,
  note?: string,
  tx?: DbOrTx,
): Promise<void> {
  const executor = tx ?? db;
  await executor
    .insert(allowanceLedger)
    .values({
      userId,
      delta: units,
      action,
      refId,
      note: note ?? null,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: allowanceLedger.refId });
}
