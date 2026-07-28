// api/lib/credit-charge.ts
//
// THE SINGLE WRITER for the unified credit engine (D1, epic #50). Every mutation
// of credit_ledger + credit_balances flows through charge()/grant() here, in ONE
// transaction, so the invariant `balance_cents == SUM(credit_ledger.delta_cents)`
// per user can never drift. Raw `db.insert(creditLedger)` / bare UPDATE of
// credit_balances outside this file is ILLEGAL after D2 (grep guard in D2).
//
// SHIPPED DORMANT (D1): fully implemented + tested, but NO call site invokes it
// yet — D3 moves the AI call sites onto charge() in shadow. Nothing in the live
// request path imports this module in D1.
//
// Money rules (mirror shared/domain/credit-money.ts, which owns the arithmetic):
//   - delivered:false  → universal no-op, NO transaction opened (undelivered work
//     is never billed).
//   - dryRun:true      → SHADOW: compute what WOULD happen, write NOTHING.
//   - idempotency      → INSERT credit_charges … ON CONFLICT (ref_id) DO NOTHING
//     RETURNING; empty RETURNING = replay → return early, bag does NOT
//     re-accumulate, no ledger/balance mutation.
//   - sub-cent         → floor(bag+owed) < 1 → NO ledger row, only the bag
//     remainder is persisted (still one balance upsert to carry the bag).
//   - flush            → floor >= 1 → exactly ONE negative `consumption` ledger
//     row = the balance decrement, in the same tx; remainder retained in bag.
//   - balance mutation → ALWAYS INSERT … ON CONFLICT (user_id) DO UPDATE (upsert),
//     never a bare UPDATE (a first-ever charge for a user has no balance row yet).
//   - per-user serialization → the balance row is CREATED-IF-MISSING then locked
//     `FOR UPDATE` BEFORE the bag is read, so two concurrent delivered charges for
//     one user can never read the same stale bag_cents and commit stale remainders
//     (bag accrual+flush is serialized on the row lock, not raced in app code).
//   - negative balance is kept REAL (admission gating is D4, not here).
//
// ref_id NAMESPACE CONVENTION (invariant safety):
//   credit_ledger.ref_id is a GLOBAL key shared by every writer (charge
//   consumption rows, grant/purchase rows, and the legacy/backfill rails). A
//   consumption row's ref_id is therefore NAMESPACED as `charge:<refId>` so it can
//   NEVER collide with a grant/purchase/legacy/allowance ref_id that happens to
//   reuse the same raw string. credit_charges still keys idempotency on the RAW
//   refId (its own PK) — the namespace lives only on the ledger side. The paired
//   ledger insert uses RETURNING and THROWS on an unexpected empty result so an
//   unforeseen ref_id collision ROLLS BACK the whole tx instead of silently
//   committing a balance debit with no ledger row (invariant break). Replay is
//   owned SOLELY by the credit_charges claim above — NOT by the ledger insert.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { creditConfig } from "../../drizzle/schema";
import { applyMultiplier, flushBag, MULT_DEFAULT_X100 } from "../../shared/domain/credit-money";
import { CHARGE_LEDGER_REF_PREFIX, assertExternalRefId } from "../../shared/domain/credit-reserved";

// Re-export so existing importers of the prefix keep working; the canonical
// definition (+ the full reserved list) lives in shared/domain/credit-reserved.ts.
export { CHARGE_LEDGER_REF_PREFIX };

/** Namespace a raw charge refId for the credit_ledger consumption row. */
export function chargeLedgerRefId(rawRefId: string): string {
  return `${CHARGE_LEDGER_REF_PREFIX}${rawRefId}`;
}

/** Minimal scope contract — the money core only needs the userId. */
export interface ChargeScope {
  readonly userId: string;
}

export interface ChargeParams {
  scope: ChargeScope;
  /** Open-string funding/spend source — drives the mult.<source> config lookup. */
  source: string;
  /** Raw (pre-multiplier) cost in cents; may be fractional (sub-cent metering). */
  rawCents: number;
  /** Idempotency key — credit_charges PK; a replay with the same refId is a no-op. */
  refId: string;
  /** Was the underlying work delivered? false → universal no-op, no tx. */
  delivered: boolean;
  /** Shadow mode — compute the outcome but write NOTHING (CREDITS_MODE=shadow). */
  dryRun: boolean;
}

export interface ChargeResult {
  /** "no-op" (undelivered), "replay" (ref already charged), "shadow" (dryRun), */
  /** "flushed" (a consumption row written), or "sub-cent" (bag only, no row). */
  outcome: "no-op" | "replay" | "shadow" | "flushed" | "sub-cent";
  /** Whole cents moved to the ledger this call (0 for no-op/replay/sub-cent). */
  flushCents: number;
  /** Fractional owed cents computed from raw × multiplier (audit/shadow). */
  owedCents: number;
}

/**
 * Resolve the ×100 billing multiplier for a source from credit_config
 * (`mult.<source>`). Unlisted source → MULT_DEFAULT_X100 (100 = 1×). Read live
 * (uncached) so an admin knob change takes effect without a redeploy.
 */
async function multiplierFor(source: string): Promise<number> {
  const key = `mult.${source}`;
  const [row] = await db
    .select({ value: creditConfig.valueInt })
    .from(creditConfig)
    .where(sql`${creditConfig.key} = ${key}`)
    .limit(1);
  return row?.value ?? MULT_DEFAULT_X100;
}

/**
 * Meter a delivered charge against the user's materialized balance. DORMANT in
 * D1 (no call site). See file header for the full rule set. Concentrates ledger
 * + balance writes in this one transaction (the single writer).
 */
export async function charge(params: ChargeParams): Promise<ChargeResult> {
  const { scope, source, rawCents, refId, delivered, dryRun } = params;

  // delivered:false → never bill undelivered work; do not even open a tx.
  if (!delivered) {
    return { outcome: "no-op", flushCents: 0, owedCents: 0 };
  }

  const multX100 = await multiplierFor(source);
  const owedCents = applyMultiplier(rawCents, multX100);

  // dryRun (shadow) → compute the would-be flush against the CURRENT bag, but
  // write nothing. Read the bag to make the shadow figure realistic.
  if (dryRun) {
    const [bagRow] = await db
      .select({ bag: sql<string>`coalesce(bag_cents, '0')` })
      .from(sql`credit_balances`)
      .where(sql`user_id = ${scope.userId}::uuid`)
      .limit(1);
    const bag = bagRow ? Number(bagRow.bag) : 0;
    const { flushCents } = flushBag(bag, owedCents);
    return { outcome: "shadow", flushCents, owedCents };
  }

  return db.transaction(async (tx) => {
    // Idempotency claim FIRST: an empty RETURNING = this refId already charged
    // (replay) → return early. The bag must NOT re-accumulate on replay.
    const claim = await tx.execute(sql`
      INSERT INTO credit_charges (ref_id, user_id, source, raw_cents, owed_cents, created_by, last_upd_by)
      VALUES (
        ${refId},
        ${scope.userId}::uuid,
        ${source},
        ${rawCents}::numeric,
        ${owedCents}::numeric,
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING ref_id
    `);
    if ((claim.rows as unknown[]).length === 0) {
      return { outcome: "replay", flushCents: 0, owedCents } satisfies ChargeResult;
    }

    // PER-USER SERIALIZATION. Before reading the carried bag, GUARANTEE the
    // balance row exists (idempotent upsert of a zero-effect row) then take a
    // `FOR UPDATE` row lock on it. Two concurrent delivered charges for the same
    // user now serialize here: the second blocks until the first commits, so it
    // reads the ALREADY-flushed bag_cents, never the stale pre-charge value.
    // Without this the bag read below could race (bag 0.4 + two owed 0.4 → both
    // persist 0.8 instead of the correct serial flush 1 / remainder 0.2).
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (${scope.userId}::uuid, 0, '0'::numeric, 0, ${scope.userId}::uuid, ${scope.userId}::uuid)
      ON CONFLICT (user_id) DO NOTHING
    `);
    const bagResult = await tx.execute(sql`
      SELECT coalesce(bag_cents, '0') AS bag
      FROM credit_balances
      WHERE user_id = ${scope.userId}::uuid
      FOR UPDATE
    `);
    const bagRows = bagResult.rows as Array<{ bag: string }>;
    const bag = bagRows[0] ? Number(bagRows[0].bag) : 0;
    const { flushCents, remainderCents } = flushBag(bag, owedCents);

    // Balance write on the now-LOCKED row. The row is guaranteed to exist (created
    // above), so this decrements the balance and persists the new bag remainder
    // atomically under the lock. Kept as INSERT … ON CONFLICT (user_id) DO UPDATE
    // (never a bare UPDATE) so the single-writer upsert shape is preserved.
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${-flushCents},
        ${remainderCents}::numeric,
        0,
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (user_id) DO UPDATE SET
        balance_cents = credit_balances.balance_cents - ${flushCents},
        bag_cents = ${remainderCents}::numeric,
        last_upd_at = now(),
        last_upd_by = ${scope.userId}::uuid
    `);

    // floor(bag+owed) < 1 → sub-cent: bag persisted above, NO ledger row.
    if (flushCents < 1) {
      return { outcome: "sub-cent", flushCents: 0, owedCents } satisfies ChargeResult;
    }

    // Exactly ONE consumption row = the balance decrement, same tx. The ledger
    // ref_id is NAMESPACED (`charge:<refId>`) so it can never collide with a
    // grant/purchase/legacy/allowance ref_id. FAIL LOUD on an unexpected empty
    // RETURNING: idempotency/replay is owned by the credit_charges claim above,
    // NOT here, so a missing ledger row means a real ref_id collision — throw to
    // ROLL BACK the whole tx rather than commit a balance debit with no ledger row.
    const ledgerRefId = chargeLedgerRefId(refId);
    const ledgerInsert = await tx.execute(sql`
      INSERT INTO credit_ledger (user_id, delta, action, delta_cents, kind, source, ref_id, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${-flushCents},
        'consumption',
        ${-flushCents},
        'consumption',
        ${source},
        ${ledgerRefId},
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING id
    `);
    if ((ledgerInsert.rows as unknown[]).length === 0) {
      throw new Error(
        `credit_ledger consumption insert no-op'd for ref_id ${ledgerRefId} — ` +
          "unexpected ref_id collision; rolling back to preserve balance == SUM(delta).",
      );
    }

    return { outcome: "flushed", flushCents, owedCents } satisfies ChargeResult;
  });
}

export interface GrantParams {
  scope: ChargeScope;
  /** Positive cents to add (grant/purchase money-in). */
  cents: number;
  source: string;
  refId: string;
  kind: "grant" | "purchase";
}

/**
 * Money-IN through the single writer: one positive ledger row + balance upsert +
 * reference_cents anchor bump, in one tx, idempotent by ref_id. DORMANT in D1
 * (D2 routes subscription/coupon/purchase/admin grants here). Kept here so ALL
 * ledger+balance writes live in this one file.
 */
export async function grant(params: GrantParams): Promise<{ applied: boolean }> {
  const { scope, cents, source, refId, kind } = params;
  // RESERVED-PREFIX GUARD. grant() writes the caller's raw refId straight into the
  // GLOBAL credit_ledger.ref_id. A caller refId beginning with an internal
  // namespace (`charge:` / `legacy_allowance:`) would shadow a later charge /
  // backfill row on the same key, making that row's fail-loud insert no-op and
  // roll back a legitimate write. Reject it at the money-core boundary (shared
  // guard — same one grantCredits/coupon-redeem use).
  assertExternalRefId(refId, "grant()");
  return db.transaction(async (tx) => {
    const inserted = await tx.execute(sql`
      INSERT INTO credit_ledger (user_id, delta, action, delta_cents, kind, source, ref_id, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${cents},
        ${kind},
        ${cents},
        ${kind},
        ${source},
        ${refId},
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING id
    `);
    if ((inserted.rows as unknown[]).length === 0) {
      return { applied: false }; // replay — grant already recorded.
    }
    // Balance upsert — INSERT … ON CONFLICT (user_id) DO UPDATE, never bare UPDATE.
    // reference_cents (wallet-gauge anchor) is snapshotted to the NEW balance on
    // positive money-in only.
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${cents},
        '0'::numeric,
        ${cents},
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (user_id) DO UPDATE SET
        balance_cents = credit_balances.balance_cents + ${cents},
        reference_cents = credit_balances.balance_cents + ${cents},
        last_upd_at = now(),
        last_upd_by = ${scope.userId}::uuid
    `);
    return { applied: true };
  });
}
