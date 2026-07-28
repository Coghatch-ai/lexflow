// api/lib/credits.ts
//
// Credit ledger operations. Money-shaped invariants:
// - balance = SUM(delta); never stored, never trusted from the client.
// - every spend/refund carries a unique ref_id (jobId / refund:<jobId>) so
//   retries and double-polls can never double-apply (DB unique index enforces).
// - spend order per AI procedure: assertCredits (cheap read) → debitCredits(
//   refId=jobId) → enqueue relay job (debit-before-enqueue; the debit is the
//   cost-commit point, reversed via refundCredits if the enqueue throws). The
//   tiny race between the read and the atomic debit can only over-spend by one
//   action for one user (single-user B2C) — accepted.
// - refunds fire from the relay.job poll when a job comes back status:error,
//   keyed refund:<jobId> — idempotent no matter how many times the client polls.

import { eq, sql, and, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { creditLedger } from "../../drizzle/schema";
import { CREDIT_COSTS, type CreditAction } from "../../shared/domain/credits";
import { atomicDebitCredits } from "./ledger-debit";
import { grant, refund } from "./credit-charge";

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

// Record the spend for an enqueued job. Atomic guarded debit via
// atomicDebitCredits: inserts ONLY when balance >= CREDIT_COSTS[action]
// (balance guard in WHERE clause). Idempotent via ref_id unique index
// (replay = no-op). Throws FORBIDDEN when balance is insufficient.
export async function debitCredits(
  userId: string,
  action: CreditAction,
  refId: string,
): Promise<void> {
  await atomicDebitCredits(userId, action, refId);
}

// Refund a failed job by its jobId. Looks up the original spend row to mirror
// its amount; no-op when the spend doesn't exist or the refund already applied.
//
// D2 (epic #50): the money-BACK-IN write is routed through the money core's
// dormant refund() writer (kind=refund) — a raw credit_ledger insert here is now
// illegal (one-writer enforcement). refund() writes the legacy `delta` column too
// (positive), so the pre-D3 SPEND admission (getBalance = SUM(delta)) still sees
// the reversal. The spend row this reverses still lives on the legacy credit rail
// until D3 retires debit-at-admission.
export async function refundCredits(userId: string, jobId: string): Promise<void> {
  const [spend] = await db
    .select({ delta: creditLedger.delta })
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
  await refund({
    scope: { userId },
    cents: -spend.delta, // spend.delta is negative → positive money-back-in
    source: "legacy",
    refId: `refund:${jobId}`,
  });
}

// Idempotent positive grant (admin). refId dedupes replays.
//
// D2 (epic #50): routed through the money core's grant() writer (kind=grant,
// source=admin) so the unified credit_ledger + credit_balances are updated in one
// tx by the single writer. grant() writes the legacy `delta` column too, so the
// pre-D3 credit-rail admission (getBalance = SUM(delta)) still sees admin grants.
// The reserved-prefix guard now lives inside grant(); passing a null refId is not
// supported by the core (idempotency needs a key) — admin always supplies one.
export async function grantCredits(
  userId: string,
  credits: number,
  _action: "admin_grant",
  refId: string,
  _note?: string,
): Promise<void> {
  await grant({
    scope: { userId },
    cents: credits,
    source: "admin",
    refId,
    kind: "grant",
  });
}
