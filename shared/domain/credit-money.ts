// shared/domain/credit-money.ts
//
// Pure money math for the unified credit engine (D1, epic #50). NO I/O — every
// function here is a total, deterministic transformation over plain numbers, so
// it is hermetically testable without a DB. The dormant charge() engine
// (api/lib/credit-charge.ts) is the ONLY writer; it composes these primitives
// with a single ledger+balance transaction. This module holds the arithmetic,
// not the persistence.
//
// FIXED-POINT MULTIPLIER (×100 integer): the billing multiplier per source is
// stored as an int where 100 = 1× (identity), 200 = 2×, 50 = 0.5×. This avoids
// float drift on the knob itself; the *product* is kept fractional (see below).
//
// FRACTIONAL BAG (never rounded here): applyMultiplier returns the exact
// fractional owed cents. The remainder below 1¢ is carried in credit_balances.
// bag_cents (numeric(12,4)) and only floored to whole cents at flush time. This
// is why sub-cent charges accumulate instead of rounding to 0 or to 1 each time.

// Multiplier is clamped to this inclusive range (×100). 0 = free, 10000 = 100×.
// Guards a mis-seeded/hostile credit_config row from producing an absurd charge.
export const MULT_MIN_X100 = 0;
export const MULT_MAX_X100 = 10000;

// Identity multiplier (1×) — the DEFAULT for any source with no mult.<source>
// config row (open-string source: unlisted → 100).
export const MULT_DEFAULT_X100 = 100;

// Hard cap on a single raw charge (cents) before the multiplier is applied.
// Defense-in-depth against an overflowing/garbage usage figure reaching money
// math. 100_000_00 = R$100k of raw cost in one action — far above any real call.
export const RAW_CENTS_CAP = 100_000_00;

/**
 * Clamp a stored ×100 multiplier into [MULT_MIN_X100, MULT_MAX_X100]. A
 * non-finite or negative knob collapses to MULT_MIN_X100 (0 = free) — never a
 * surprise charge. Callers pass the DB int directly; this is the single guard.
 */
export function clampMultiplierX100(multX100: number): number {
  if (!Number.isFinite(multX100)) return MULT_MIN_X100;
  if (multX100 < MULT_MIN_X100) return MULT_MIN_X100;
  if (multX100 > MULT_MAX_X100) return MULT_MAX_X100;
  return Math.trunc(multX100);
}

/**
 * Clamp a raw charge (cents) into [0, RAW_CENTS_CAP]. Negative or non-finite raw
 * → 0 (a charge can never be negative; a refund is a separate dormant kind).
 */
export function capRawCents(rawCents: number): number {
  if (!Number.isFinite(rawCents)) return 0;
  if (rawCents < 0) return 0;
  if (rawCents > RAW_CENTS_CAP) return RAW_CENTS_CAP;
  return rawCents;
}

/**
 * Apply the billing multiplier to a raw cent cost. The result is FRACTIONAL and
 * is NEVER rounded here — the caller carries the sub-cent remainder in the bag.
 *
 *   owedCents = cappedRaw × clampedMult / 100
 *
 * Both inputs are guarded first (cap raw, clamp mult) so this can never produce
 * a negative or non-finite figure. Example: raw=23 (0.23¢-scale), mult=200 (2×)
 * → 46.0; raw=1, mult=50 (0.5×) → 0.5 (accumulates in the bag, no round).
 */
export function applyMultiplier(rawCents: number, multX100: number): number {
  const raw = capRawCents(rawCents);
  const mult = clampMultiplierX100(multX100);
  return (raw * mult) / 100;
}

export interface FlushResult {
  /** Whole cents to move onto the ledger this flush (floor of bag+owed). */
  flushCents: number;
  /** Sub-cent remainder retained in credit_balances.bag_cents (< 1). */
  remainderCents: number;
}

/**
 * Add the (fractional) owed cents to the carried bag, then split the total into
 * a whole-cent FLUSH (what becomes a ledger consumption row / balance decrement)
 * and the sub-cent REMAINDER that stays in the bag for next time.
 *
 *   total       = bagCents + owedCents
 *   flushCents  = floor(total)      // whole cents → ledger, may be 0
 *   remainder   = total - flushCents // in [0, 1) → bag
 *
 * flushCents can be 0 when the accumulated bag is still below 1¢ — the caller
 * writes NO ledger row in that case (sub-cent no-op), but still claims the
 * charge's ref_id so a replay does not re-accumulate. remainder is always < 1.
 */
export function flushBag(bagCents: number, owedCents: number): FlushResult {
  const safeBag = Number.isFinite(bagCents) && bagCents > 0 ? bagCents : 0;
  const safeOwed = Number.isFinite(owedCents) && owedCents > 0 ? owedCents : 0;
  const total = safeBag + safeOwed;
  const flushCents = Math.floor(total);
  const remainderCents = total - flushCents;
  return { flushCents, remainderCents };
}

// ─── Pure in-memory account model (test parity, no I/O) ─────────────────────
//
// This mirrors EXACTLY what the DB charge() engine (api/lib/credit-charge.ts)
// does to (balance_cents, bag_cents, ledger) for a single op, but over plain
// objects. It exists so the D1 acceptance invariants — balance == SUM(ledger
// deltas), replay no-op, sub-cent no-ledger-row, bag-crossing-1¢ — are provable
// hermetically without a Postgres harness (this repo has none). The engine is a
// thin transaction wrapper over these same primitives, so a divergence here is a
// divergence there. Kept in shared/ (business rule, single source of truth).

/** Signed ledger row (mirrors credit_ledger). delta_cents drives the invariant. */
export interface LedgerRow {
  deltaCents: number;
  kind: "grant" | "purchase" | "refund" | "consumption" | "adjustment" | "expiry";
  source: string;
  refId: string;
}

/** Materialized per-user account (mirrors credit_balances 1:1). */
export interface Account {
  balanceCents: number;
  bagCents: number;
  referenceCents: number;
  ledger: LedgerRow[];
  /** Claimed charge ref_ids (mirrors credit_charges PK) — replay guard. */
  chargedRefIds: Set<string>;
}

export function emptyAccount(): Account {
  return {
    balanceCents: 0,
    bagCents: 0,
    referenceCents: 0,
    ledger: [],
    chargedRefIds: new Set<string>(),
  };
}

/**
 * Apply a metered CHARGE to the account, matching the dormant engine's rules:
 *  - replay (ref_id already claimed) → total no-op; bag does NOT re-accumulate.
 *  - claim ref_id, add fractional owed (raw×mult/100) to the bag.
 *  - floor(bag+owed) < 1 → NO ledger row, remainder retained (sub-cent no-op).
 *  - flushCents >= 1 → exactly ONE negative `consumption` row = balance decrement.
 * Balance is kept REAL — it may go negative (admission gating is a later slice).
 * Mutates and returns the account for ergonomic test sequencing.
 */
export function simulateCharge(
  acct: Account,
  source: string,
  rawCents: number,
  refId: string,
  multX100: number,
): Account {
  if (acct.chargedRefIds.has(refId)) return acct; // replay → no-op, no re-accumulate
  acct.chargedRefIds.add(refId);
  const owed = applyMultiplier(rawCents, multX100);
  const { flushCents, remainderCents } = flushBag(acct.bagCents, owed);
  acct.bagCents = remainderCents;
  if (flushCents >= 1) {
    // Mirror the engine: the consumption ledger ref_id is NAMESPACED (`charge:`)
    // so it can never collide with a grant/purchase/legacy/allowance ref_id.
    // credit_charges keeps the RAW refId; only the ledger side carries the prefix.
    acct.ledger.push({
      deltaCents: -flushCents,
      kind: "consumption",
      source,
      refId: `charge:${refId}`,
    });
    acct.balanceCents -= flushCents;
  }
  return acct;
}

/**
 * Apply a positive GRANT/PURCHASE (money-in) to the account: one positive ledger
 * row, balance increment, reference anchor bumped (wallet gauge basis, D4).
 * Idempotent by ref_id like the engine's grant path.
 */
export function simulateGrant(
  acct: Account,
  source: string,
  cents: number,
  refId: string,
  kind: "grant" | "purchase" = "grant",
): Account {
  if (acct.chargedRefIds.has(refId)) return acct;
  acct.chargedRefIds.add(refId);
  acct.ledger.push({ deltaCents: cents, kind, source, refId });
  acct.balanceCents += cents;
  if (cents > 0) acct.referenceCents = acct.balanceCents;
  return acct;
}

/** SUM(ledger.delta_cents) — the invariant's right-hand side. */
export function ledgerSum(acct: Account): number {
  return acct.ledger.reduce((s, r) => s + r.deltaCents, 0);
}
