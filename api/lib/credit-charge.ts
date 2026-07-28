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
import {
  resolveResetPolicy,
  shouldExpire,
  expiryAmountCents,
  expiryRefId,
  rolloverKey,
  expiryMonthsKey,
} from "../../shared/domain/credit-reset";

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

/**
 * A drizzle transaction executor — the callback arg of db.transaction. grant() /
 * refund() accept an optional one so a caller that ALREADY holds a transaction
 * (coupon redeem: the atomic per-coupon cap UPDATE + the grant MUST commit or roll
 * back together) can pass it in and have the money-core write JOIN that same
 * atomic unit instead of opening a nested transaction. Standalone callers omit it
 * and the writer opens its own db.transaction.
 */
export type CreditTx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/** Run `body` in the caller's tx when supplied, else open a fresh transaction. */
function runInTx<T>(tx: CreditTx | undefined, body: (tx: CreditTx) => Promise<T>): Promise<T> {
  if (tx !== undefined) return body(tx);
  return db.transaction(body);
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

/**
 * OPTIONAL legacy-compat mirror written IN THE SAME grant tx (D2 cutover safety).
 * The old SPEND-admission rails stay authoritative until D3 and read the LEGACY
 * `allowance_ledger` table (SUM(delta)). A grant routed to the unified
 * `credit_ledger` would be invisible to that admission, breaking live paid
 * spending. So an allowance-source grant ALSO writes its legacy allowance_ledger
 * row here — inside the SAME one-writer tx, so the money core remains the ONLY
 * writer of that table's grant rows (raw `db.insert(allowanceLedger)` is now
 * illegal outside this file). The mirror is idempotent on the same ref_id, so a
 * grant can never double. It is a temporary COMPAT row: D3 retires the legacy
 * read and this mirror with it.
 */
export interface LegacyMirror {
  /** Only `allowance_ledger` is mirrored (its old admission read is table-local). */
  table: "allowance_ledger";
  /** Legacy action tag stored on the mirror row (e.g. monthly_grant / top_up). */
  action: string;
  /** Legacy signed units (positive money-in) — the old rail's own currency. */
  units: number;
  /** Legacy ref_id for the mirror row (its own unique index; may differ from the
   *  unified ledger refId so the two indices never collide). */
  refId: string;
  note?: string | undefined;
}

export interface GrantParams {
  scope: ChargeScope;
  /** Positive cents to add (grant/purchase money-in). */
  cents: number;
  source: string;
  refId: string;
  kind: "grant" | "purchase";
  /** Legacy-compat mirror row written in the same tx (D2 cutover; see above). */
  legacyMirror?: LegacyMirror | undefined;
  /** Optional caller transaction to JOIN (coupon atomic-cap unit); see CreditTx. */
  tx?: CreditTx | undefined;
}

/**
 * Money-IN through the single writer: one positive unified ledger row + balance
 * upsert + reference_cents anchor bump (+ an optional legacy-compat mirror row),
 * all in one tx, idempotent by ref_id. D2 routes subscription / coupon / purchase
 * / admin grants here — ALL grant-side ledger writes live in this one file.
 */
export async function grant(params: GrantParams): Promise<{ applied: boolean }> {
  const { scope, cents, source, refId, kind, legacyMirror } = params;
  // RESERVED-PREFIX GUARD. grant() writes the caller's raw refId straight into the
  // GLOBAL credit_ledger.ref_id. A caller refId beginning with an internal
  // namespace (`charge:` / `legacy_allowance:`) would shadow a later charge /
  // backfill row on the same key, making that row's fail-loud insert no-op and
  // roll back a legitimate write. Reject it at the money-core boundary (shared
  // guard — same one grantCredits/coupon-redeem use).
  assertExternalRefId(refId, "grant()");
  if (legacyMirror !== undefined) assertExternalRefId(legacyMirror.refId, "grant() legacyMirror");
  return runInTx(params.tx, async (tx) => {
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
      return { applied: false }; // replay — grant already recorded (both rails).
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
    // Legacy-compat mirror (allowance_ledger) — SAME tx, idempotent on its ref_id.
    // Keeps the pre-D3 SPEND admission (which reads allowance_ledger) able to see
    // this grant, without a second raw writer outside the core.
    if (legacyMirror !== undefined) {
      await tx.execute(sql`
        INSERT INTO allowance_ledger (user_id, delta, action, ref_id, note, created_by, last_upd_by)
        VALUES (
          ${scope.userId}::uuid,
          ${legacyMirror.units},
          ${legacyMirror.action},
          ${legacyMirror.refId},
          ${legacyMirror.note ?? null},
          ${scope.userId}::uuid,
          ${scope.userId}::uuid
        )
        ON CONFLICT (ref_id) DO NOTHING
      `);
    }
    return { applied: true };
  });
}

export interface RefundParams {
  scope: ChargeScope;
  /** Positive cents to return (reverses a prior consumption/spend). */
  cents: number;
  source: string;
  /** Idempotency key for the refund ledger row (e.g. `refund:<jobId>`). */
  refId: string;
  /** Optional legacy-compat mirror (reverses the legacy spend row's own rail). */
  legacyMirror?: LegacyMirror | undefined;
  /** Optional caller transaction to JOIN; see CreditTx. */
  tx?: CreditTx | undefined;
}

/**
 * DORMANT correction path — money BACK-IN through the single writer as
 * `kind=refund`. Delivery is confirmed by delivered-only charging (D3), so refund
 * is NOT the normal correction path; it survives only to reverse a legacy spend
 * whose relay job came back status:error before the delivered-only cutover. Kept
 * here so refund ledger writes are ALSO concentrated in the one money-core file
 * (raw refund inserts in credits.ts / allowance.ts are now illegal). Idempotent
 * by ref_id; balance upsert never bumps reference_cents (a refund is a correction,
 * not a fresh money-in anchor).
 */
export async function refund(params: RefundParams): Promise<{ applied: boolean }> {
  const { scope, cents, source, refId, legacyMirror } = params;
  assertExternalRefId(refId, "refund()");
  if (legacyMirror !== undefined) assertExternalRefId(legacyMirror.refId, "refund() legacyMirror");
  return runInTx(params.tx, async (tx) => {
    const inserted = await tx.execute(sql`
      INSERT INTO credit_ledger (user_id, delta, action, delta_cents, kind, source, ref_id, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${cents},
        'refund',
        ${cents},
        'refund',
        ${source},
        ${refId},
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING id
    `);
    if ((inserted.rows as unknown[]).length === 0) {
      return { applied: false }; // replay — refund already recorded.
    }
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${cents},
        '0'::numeric,
        0,
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (user_id) DO UPDATE SET
        balance_cents = credit_balances.balance_cents + ${cents},
        last_upd_at = now(),
        last_upd_by = ${scope.userId}::uuid
    `);
    if (legacyMirror !== undefined) {
      await tx.execute(sql`
        INSERT INTO allowance_ledger (user_id, delta, action, ref_id, note, created_by, last_upd_by)
        VALUES (
          ${scope.userId}::uuid,
          ${legacyMirror.units},
          ${legacyMirror.action},
          ${legacyMirror.refId},
          ${legacyMirror.note ?? null},
          ${scope.userId}::uuid,
          ${scope.userId}::uuid
        )
        ON CONFLICT (ref_id) DO NOTHING
      `);
    }
    return { applied: true };
  });
}

export interface ExpireParams {
  scope: ChargeScope;
  /** Grant source whose window elapsed (drives rollover/expiry_months lookup). */
  source: string;
  /** Period label — stable across replays (e.g. `YYYY-MM` or period-end ISO). */
  period: string;
  /** Whole months elapsed since the grant window opened (caller-computed). */
  monthsElapsed: number;
}

export interface ExpireResult {
  outcome: "rollover" | "not-due" | "nothing-to-expire" | "replay" | "expired";
  /** Whole cents clawed back (0 unless outcome === "expired"). */
  expiredCents: number;
}

/**
 * Per-source RESET through the single writer. Reads the source's config knobs
 * (`rollover.<source>` / `expiry_months.<source>`) LIVE, and when the window has
 * elapsed with rollover=false, appends ONE NEGATIVE `kind=expiry` ledger row with
 * the deterministic `ref_id = user:<source>:<period>` in the SAME tx that
 * decrements credit_balances — append-only, never a delete/rewrite/bare-update.
 * rollover=true → no reset entry. Replaying for the same (user, source, period)
 * is absorbed by the unique ref_id index → exactly one expiry row ever appears.
 *
 * SOURCE/WINDOW-AWARE (the clawed amount): expiry removes only the EXPIRING
 * SOURCE's OWN leftover — the net of that source's ledger rows (its grants minus
 * its consumption/expiry), NEVER the whole unified credit_balances (which sums
 * every source). So expiring `subscription` can never claw back purchase/admin/
 * coupon funds that should roll over. Derived in-tx from
 * `SUM(credit_ledger.delta_cents) WHERE source = <source>` under the same balance
 * row lock, then clamped ≥0 (already-spent-down source loses only what remains).
 *
 * SHIPPED DORMANT (D2): the unified credit_balances/credit_ledger cannot reflect
 * TRUE consumption until live spend routes through charge() — that is D3. In D2
 * live spend is still the legacy debit-at-admission rail (allowance_ledger/
 * credit_ledger legacy rows), so a source's unified leftover is NOT yet its real
 * remaining balance. Therefore expire() MUST NOT be wired to any scheduled/live
 * activation against real balances in D2. It ships exactly like charge() shipped
 * dormant in D1: fully implemented, config-driven, unit-tested against the unified
 * model — but NO production/scheduled caller invokes it. ACTIVATION moves to D3,
 * after spend is unified. (Guard: api/lib/credit-charge-d2.test.ts asserts no live
 * caller of expire() exists yet.)
 */
export async function expire(params: ExpireParams): Promise<ExpireResult> {
  const { scope, source, period, monthsElapsed } = params;
  const [rolloverRow] = await db
    .select({ value: creditConfig.valueInt })
    .from(creditConfig)
    .where(sql`${creditConfig.key} = ${rolloverKey(source)}`)
    .limit(1);
  const [expiryRow] = await db
    .select({ value: creditConfig.valueInt })
    .from(creditConfig)
    .where(sql`${creditConfig.key} = ${expiryMonthsKey(source)}`)
    .limit(1);
  const policy = resolveResetPolicy(rolloverRow?.value, expiryRow?.value);
  if (!shouldExpire(policy, monthsElapsed)) {
    return { outcome: policy.rollover ? "rollover" : "not-due", expiredCents: 0 };
  }
  const refId = expiryRefId(scope.userId, source, period);
  return db.transaction(async (tx) => {
    // Lock the balance row (create-if-missing then FOR UPDATE) BEFORE reading it,
    // so concurrent expiry / charge for the same user serialize on the row.
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (${scope.userId}::uuid, 0, '0'::numeric, 0, ${scope.userId}::uuid, ${scope.userId}::uuid)
      ON CONFLICT (user_id) DO NOTHING
    `);
    await tx.execute(sql`
      SELECT balance_cents FROM credit_balances WHERE user_id = ${scope.userId}::uuid FOR UPDATE
    `);
    // SOURCE/WINDOW-AWARE leftover: the net of THIS source's own ledger rows (its
    // grants minus its consumption/expiry), NOT the whole unified balance_cents.
    // Clamped ≥0 by expiryAmountCents so a source spent to/below its own zero has
    // nothing to claw back and other sources' funds are never touched.
    const leftoverResult = await tx.execute(sql`
      SELECT coalesce(SUM(delta_cents), 0) AS leftover
      FROM credit_ledger
      WHERE user_id = ${scope.userId}::uuid AND source = ${source}
    `);
    const leftoverRows = leftoverResult.rows as Array<{ leftover: number | string }>;
    const leftover = leftoverRows[0] ? Number(leftoverRows[0].leftover) : 0;
    const amount = expiryAmountCents(leftover);
    if (amount <= 0) {
      return { outcome: "nothing-to-expire", expiredCents: 0 } satisfies ExpireResult;
    }
    // Append-only NEGATIVE expiry row, deterministic ref_id (idempotency). An
    // empty RETURNING means the ref_id already exists → this is a replay of the
    // same (user, source, period) → no-op (no second balance decrement).
    const ledgerInsert = await tx.execute(sql`
      INSERT INTO credit_ledger (user_id, delta, action, delta_cents, kind, source, ref_id, created_by, last_upd_by)
      VALUES (
        ${scope.userId}::uuid,
        ${-amount},
        'expiry',
        ${-amount},
        'expiry',
        ${source},
        ${refId},
        ${scope.userId}::uuid,
        ${scope.userId}::uuid
      )
      ON CONFLICT (ref_id) DO NOTHING
      RETURNING id
    `);
    if ((ledgerInsert.rows as unknown[]).length === 0) {
      return { outcome: "replay", expiredCents: 0 } satisfies ExpireResult;
    }
    // Same tx: decrement the materialized balance by the clawed-back leftover.
    await tx.execute(sql`
      INSERT INTO credit_balances (user_id, balance_cents, bag_cents, reference_cents, created_by, last_upd_by)
      VALUES (${scope.userId}::uuid, ${-amount}, '0'::numeric, 0, ${scope.userId}::uuid, ${scope.userId}::uuid)
      ON CONFLICT (user_id) DO UPDATE SET
        balance_cents = credit_balances.balance_cents - ${amount},
        last_upd_at = now(),
        last_upd_by = ${scope.userId}::uuid
    `);
    return { outcome: "expired", expiredCents: amount } satisfies ExpireResult;
  });
}
