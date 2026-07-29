// api/lib/admission.ts
//
// Admission gate for the unified credit engine (D4, epic #50). This is the SOLE
// spend-admission path — the old debit-at-admission rails (the allowance debit
// helpers, the shared guarded-debit module, and the free-tier daily counter) are
// DELETED. A spend action reads the materialized credit_balances.balance_cents and
// is admitted only when the balance is positive.
//
// GRACE-AT-ZERO: admission checks balance > 0 BEFORE the spend. The request that
// spends the last cent reads a still-positive balance and completes; the NEXT
// request reads balance <= 0 and is denied. So a user is never cut off mid-action —
// they always get to finish the one that drains the wallet, and only the following
// one is refused.
//
// FAIL-CLOSED with a BURST door: a balance READ failure must not silently admit
// unbounded free work (fail-open would let a DB blip become unmetered spend). But a
// hard fail-closed on every read error would also break every action during a brief
// blip. Compromise (Codex): admit at most BURST=3 actions while the read is failing,
// then deny. The burst counter is per-process and best-effort — it caps the blast
// radius of a read outage without a hard outage of its own.
//
// NON-SPEND door: actions that cost nothing (reads, history, config) must never be
// blocked by a billing read. admitNonSpend() is fail-OPEN — it never denies.

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";

/** Max actions admitted while balance reads are failing before we deny (fail-closed burst). */
export const BURST_ADMIT_LIMIT = 3;

/** The FORBIDDEN message shown when the wallet is empty (pt-BR, user-facing). */
export const INSUFFICIENT_BALANCE_MESSAGE =
  "Saldo insuficiente. Resgate um cupom ou adquira mais para continuar usando a IA.";

// Per-process burst budget for the fail-closed door. Reset to 0 on any successful
// balance read (a healthy read means the outage is over). Best-effort — a Lambda
// cold start resets it, which only ever makes the door MORE conservative.
let burstUsed = 0;

/**
 * Read the user's materialized balance in whole cents. Throws on a read failure —
 * the caller (admit) decides fail-closed-burst policy. Returns 0 when no balance
 * row exists yet (a brand-new user with no grant is correctly at zero → denied).
 */
export async function readBalanceCents(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(balance_cents, 0)` })
    .from(sql`credit_balances`)
    .where(sql`user_id = ${userId}::uuid`)
    .limit(1);
  return row ? Number(row.balance) : 0;
}

/**
 * Admit or DENY a SPEND action. Reads credit_balances; admits when balance > 0
 * (grace-at-zero — the last-cent request still reads positive and completes, the
 * next is denied). On a READ FAILURE, admits up to BURST_ADMIT_LIMIT actions then
 * denies (fail-closed burst). A successful read resets the burst budget.
 *
 * `read` is the balance reader — defaulted to readBalanceCents, injectable so the
 * control-flow (grace / burst) is testable hermetically without a DB.
 *
 * Throws TRPCError FORBIDDEN when denied. Returns void when admitted.
 */
export async function admit(
  userId: string,
  read: (userId: string) => Promise<number> = readBalanceCents,
): Promise<void> {
  let balanceCents: number;
  try {
    balanceCents = await read(userId);
    burstUsed = 0; // healthy read → outage over, refill the burst budget.
  } catch (err) {
    // Fail-CLOSED burst: admit a few, then deny.
    if (burstUsed < BURST_ADMIT_LIMIT) {
      burstUsed += 1;
      console.warn("[credits] admission balance-read failed — burst-admitting", {
        userId,
        burstUsed,
        limit: BURST_ADMIT_LIMIT,
        err,
      });
      return;
    }
    console.error("[credits] admission balance-read failed — burst exhausted, denying", {
      userId,
      err,
    });
    throw new TRPCError({ code: "FORBIDDEN", message: INSUFFICIENT_BALANCE_MESSAGE });
  }

  // Healthy read. Grace-at-zero: admit while strictly positive; deny at <= 0.
  if (balanceCents <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: INSUFFICIENT_BALANCE_MESSAGE });
  }
}

/**
 * Non-spend door (reads / history / config). Fail-OPEN — never denies. A billing
 * read failure must never block a free action. Kept as an explicit call so intent
 * is legible at the call site (this action is deliberately not gated).
 */
export function admitNonSpend(): void {
  // Intentionally a no-op: non-spend actions are never denied.
}

/** Test-only: reset the per-process burst budget between cases. */
export function __resetBurstForTest(): void {
  burstUsed = 0;
}
