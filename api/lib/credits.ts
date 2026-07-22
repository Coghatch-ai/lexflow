// api/lib/credits.ts
//
// Credit ledger operations. Money-shaped invariants:
// - balance = SUM(delta); never stored, never trusted from the client.
// - every spend/refund carries a unique ref_id (jobId / refund:<jobId>) so
//   retries and double-polls can never double-apply (DB unique index enforces).
// - spend order per AI procedure: assertCredits (cheap read) → enqueue relay
//   job → debitCredits(refId=jobId). The tiny race between read and debit can
//   only over-spend by one action for one user (single-user B2C) — accepted.
// - refunds fire from the relay.job poll when a job comes back status:error,
//   keyed refund:<jobId> — idempotent no matter how many times the client polls.

import { eq, sql, and, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { creditLedger } from "../../drizzle/schema";
import { CREDIT_COSTS, type CreditAction } from "../../shared/domain/credits";

export async function getBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return row?.balance ?? 0;
}

// Throw FORBIDDEN when the balance can't cover `action`. Call BEFORE enqueueing
// (the relay job is the cost commit — don't queue work the user can't pay for).
export async function assertCredits(userId: string, action: CreditAction): Promise<void> {
  const balance = await getBalance(userId);
  if (balance < CREDIT_COSTS[action]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Créditos insuficientes (saldo: ${String(balance)}). Adquira mais créditos para continuar.`,
    });
  }
}

// Record the spend for an enqueued job. Idempotent via ref_id unique index.
export async function debitCredits(
  userId: string,
  action: CreditAction,
  refId: string,
): Promise<void> {
  await db
    .insert(creditLedger)
    .values({
      userId,
      delta: -CREDIT_COSTS[action],
      action,
      refId,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: creditLedger.refId });
}

// Refund a failed job by its jobId. Looks up the original spend row to mirror
// its amount; no-op when the spend doesn't exist or the refund already applied.
export async function refundCredits(userId: string, jobId: string): Promise<void> {
  const [spend] = await db
    .select({ delta: creditLedger.delta, action: creditLedger.action })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.refId, jobId),
        lt(creditLedger.delta, 0),
      ),
    )
    .limit(1);
  if (spend === undefined) return;
  await db
    .insert(creditLedger)
    .values({
      userId,
      delta: -spend.delta,
      action: "refund",
      refId: `refund:${jobId}`,
      note: spend.action,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: creditLedger.refId });
}

// Idempotent positive grant (admin). refId dedupes replays.
export async function grantCredits(
  userId: string,
  credits: number,
  action: "admin_grant",
  refId: string | null,
  note?: string,
): Promise<void> {
  await db
    .insert(creditLedger)
    .values({
      userId,
      delta: credits,
      action,
      refId,
      note: note ?? null,
      createdBy: userId,
      lastUpdBy: userId,
    })
    .onConflictDoNothing({ target: creditLedger.refId });
}
