// api/lib/ledger-debit.ts
//
// Shared atomic debit helper for the allowance and credit spend rails.
//
// DESIGN — per-user advisory lock + guarded INSERT-SELECT:
//
//   1. pg_advisory_xact_lock(<hash of userId + rail namespace>) — serializes
//      concurrent debits for the same user on the same rail inside the same
//      Postgres transaction. The lock is automatically released on commit or
//      rollback, so no cleanup is needed. Two simultaneous debits for the same
//      user+rail will queue here; the second sees the committed balance of the
//      first and is refused when it would overspend.
//
//   2. Guarded INSERT-SELECT — single SQL statement:
//
//        INSERT INTO <ledger> (user_id, delta, action, ref_id, …)
//        SELECT <values>
//        WHERE (SELECT coalesce(sum(delta), 0) FROM <ledger> WHERE user_id = ?)
//              >= cost
//        ON CONFLICT (ref_id) DO NOTHING
//        RETURNING id
//
//      The WHERE predicate is defense-in-depth. After the advisory lock
//      serializes access, only one debit at balance==cost can succeed; the
//      guard also catches stale callers that hold their own snapshot.
//
// Result shapes:
//   - 1 row returned   → debit applied (new or first-time write).
//   - 0 rows, ref_id already in table → replay / idempotent no-op → success.
//   - 0 rows, ref_id NOT in table → balance would go negative → FORBIDDEN.
//
// Refund and grant paths are NOT routed through this helper — only spends.
// Free-tier path uses claimFreeTierCounter (allowance.ts) — never this helper.
//
// No migration needed: advisory locks need no schema. Existing ref_id unique
// indexes + per-user ledger indexes suffice for the guarded SELECT.

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { allowanceLedger, creditLedger } from "../../drizzle/schema";
import { CREDIT_COSTS, type CreditAction } from "../../shared/domain/credits";
import { ALLOWANCE_COST } from "../../shared/domain/allowance";

// ── Lock key derivation ──────────────────────────────────────────────────────

/**
 * Stable 32-bit unsigned integer derived from (userId, namespace) via djb2.
 * Returns a safe JS number (max 2^32-1 < Number.MAX_SAFE_INTEGER).
 * Different namespaces ("allowance" vs "credit") produce different keys so the
 * two rails for the same user do not unnecessarily block each other.
 *
 * TODO(live-concurrency): a full integration test — two concurrent debits for
 * the same user+rail at balance==cost, exactly one succeeds — should run
 * against a live Postgres instance pre-deploy. The repo has no DB harness;
 * source-text guards (ledger-debit.test.ts D1) are the strongest tractable
 * proof without one.
 */
export function hashLockKey(userId: string, namespace: string): number {
  const str = `${userId}|${namespace}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // djb2: hash = hash * 33 ^ char
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    // Keep within 32-bit unsigned range to stay well inside Number.MAX_SAFE_INTEGER.
    hash = hash >>> 0;
  }
  return hash;
}

// ── Internal shared implementation ──────────────────────────────────────────

type LedgerTable = typeof allowanceLedger | typeof creditLedger;

interface DebitParams {
  table: LedgerTable;
  userId: string;
  cost: number; // positive integer; guard checks balance >= cost
  delta: number; // negative integer stored in ledger
  action: string;
  refId: string;
  forbiddenMessage: string;
  createdBy: string;
  lastUpdBy: string;
  /** Advisory-lock namespace — differentiates rails for same user. */
  lockNamespace: string;
}

/**
 * Core guarded-insert. Takes a per-user+rail pg_advisory_xact_lock FIRST,
 * then inserts the debit row ONLY when the current per-user balance (SUM of
 * all delta rows) would remain >= 0 after the debit.
 *
 * The advisory lock serializes concurrent debits for the same user on the same
 * rail: under READ COMMITTED, two simultaneous callers would both see the
 * pre-debit SUM without the lock; with the lock the second caller waits until
 * the first commits and then sees the reduced balance.
 *
 * Returns `true` when a new row was inserted (first occurrence of refId).
 * Returns `false` when refId already exists (idempotent replay — treat as success).
 * Throws TRPCError FORBIDDEN when balance is insufficient (guard fires, 0 rows,
 * no existing refId in table).
 */
async function guardedInsert(p: DebitParams): Promise<boolean> {
  const lockKey = hashLockKey(p.userId, p.lockNamespace);

  return db.transaction(async (tx) => {
    // Step 1: serialize concurrent debits for this user+rail.
    // pg_advisory_xact_lock blocks until the lock is available and releases
    // automatically on transaction commit or rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Step 2: guarded INSERT-SELECT — single statement, defense-in-depth.
    // drizzle's sql`` tag accepts LedgerTable directly as a SQLWrapper.
    const result = await tx.execute(sql`
      INSERT INTO ${p.table} (user_id, delta, action, ref_id, created_by, last_upd_by)
      SELECT
        ${p.userId}::uuid,
        ${p.delta}::int,
        ${p.action},
        ${p.refId},
        ${p.createdBy}::uuid,
        ${p.lastUpdBy}::uuid
      WHERE (
        SELECT coalesce(sum(delta), 0)::int
        FROM ${p.table}
        WHERE user_id = ${p.userId}::uuid
      ) >= ${p.cost}::int
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING id
    `);

    const rows = result.rows as Array<{ id: string }>;

    if (rows.length > 0) {
      // New row inserted — debit applied.
      return true;
    }

    // 0 rows: either replay (refId already exists) or insufficient balance.
    // Distinguish by checking refId presence.
    const existing = await tx.execute(sql`
      SELECT id FROM ${p.table} WHERE ref_id = ${p.refId} LIMIT 1
    `);
    if ((existing.rows as Array<{ id: string }>).length > 0) {
      // Replay — idempotent success.
      return false;
    }

    // Balance guard fired — insufficient funds.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: p.forbiddenMessage,
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomic allowance debit. Takes pg_advisory_xact_lock(hash(userId,"allowance"))
 * then inserts a spend row ONLY when the pre-debit balance >= ALLOWANCE_COST.
 * Idempotent: a replay (same refId) returns without error.
 * Throws FORBIDDEN when balance is insufficient.
 *
 * MUST only be called for PAID users — free-tier spends use claimFreeTierCounter
 * and must NOT write allowance_ledger (F3 invariant from allowance.ts).
 */
export async function atomicDebitAllowance(userId: string, refId: string): Promise<void> {
  await guardedInsert({
    table: allowanceLedger,
    userId,
    cost: ALLOWANCE_COST,
    delta: -ALLOWANCE_COST,
    action: "spend",
    refId,
    forbiddenMessage:
      "Saldo de IA insuficiente. Adquira mais allowance para continuar usando as funcionalidades principais.",
    createdBy: userId,
    lastUpdBy: userId,
    lockNamespace: "allowance",
  });
}

/**
 * Atomic credit debit. Takes pg_advisory_xact_lock(hash(userId,"credit"))
 * then inserts a spend row ONLY when the pre-debit balance >= CREDIT_COSTS[action].
 * Idempotent: a replay (same refId) returns without error.
 * Throws FORBIDDEN when balance is insufficient.
 */
export async function atomicDebitCredits(
  userId: string,
  action: CreditAction,
  refId: string,
): Promise<void> {
  const cost = CREDIT_COSTS[action];
  await guardedInsert({
    table: creditLedger,
    userId,
    cost,
    delta: -cost,
    action,
    refId,
    forbiddenMessage: `Créditos insuficientes. Adquira mais créditos para continuar.`,
    createdBy: userId,
    lastUpdBy: userId,
    lockNamespace: "credit",
  });
}
