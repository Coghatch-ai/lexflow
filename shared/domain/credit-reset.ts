// shared/domain/credit-reset.ts
//
// Per-source RESET POLICY for the unified credit engine (D2, epic #50). Owner's
// decision (verbatim in design/monetization-port/prd-d1-d5.md) is that reset is
// NOT one global rule — it is a per-source, config-driven policy carried in
// credit_config:
//   - rollover.<source>      (bool as int: 1 = leftover carries, 0 = expires)
//   - expiry_months.<source> (int N: months until an unused grant expires;
//                             0 / absent = never expires)
// When a grant's window elapses and rollover=false, the leftover EXPIRES via an
// append-only NEGATIVE ledger row (kind=expiry) with a deterministic
// ref_id = `user:<source>:<period>` in the SAME one-writer tx that updates
// credit_balances — never a delete/rewrite/bare-update of old grant rows. When
// rollover=true there is NO reset entry at all (the next grant just adds).
//
// PURE, no I/O. The DB-side single writer (api/lib/credit-charge.ts expire())
// composes these primitives with one ledger+balance transaction; this module
// owns the arithmetic + the config-key + ref_id conventions so the D2 acceptance
// (deterministic-refId idempotency; rollover→no row; expire→negative row +
// invariant) is provable hermetically without a Postgres harness.

import type { Account, LedgerRow } from "./credit-money";

// ── credit_config knob keys (config-driven, per open-string source) ──────────

/** Config key for the rollover flag of a source (`rollover.<source>`; 1|0). */
export function rolloverKey(source: string): string {
  return `rollover.${source}`;
}

/** Config key for the expiry window of a source (`expiry_months.<source>`; int N). */
export function expiryMonthsKey(source: string): string {
  return `expiry_months.${source}`;
}

/**
 * Deterministic ledger ref_id for a source's expiry at a given period. The PRD
 * spells this `user:<source>:<period>`; because credit_ledger.ref_id is a GLOBAL
 * unique key, `<user>` is the ACTUAL userId (not a literal), so two users' expiry
 * for the same source/period never collide. Replaying the expiry routine for the
 * same (user, source, period) claims this identical ref_id, so the unique ref_id
 * index absorbs the second run (exactly one kind=expiry row ever appears).
 * `period` is a caller-chosen period label (e.g. an ISO `YYYY-MM` month key or a
 * subscription period end) — stable across replays for the same window.
 */
export function expiryRefId(userId: string, source: string, period: string): string {
  return `${userId}:${source}:${period}`;
}

// ── Resolved policy ──────────────────────────────────────────────────────────

export interface ResetPolicy {
  /** true → leftover carries; NO reset entry is ever written for this source. */
  rollover: boolean;
  /** Months until an unused grant expires; 0 = never expires. */
  expiryMonths: number;
}

/**
 * Resolve a source's reset policy from the raw credit_config ints (either may be
 * absent → undefined). Defaults are the SAFE, non-destructive ones: rollover
 * TRUE (leftover carries) and expiryMonths 0 (never expires) — a source with no
 * config knobs never loses balance. rollover is bool-as-int (any non-zero = on);
 * a negative / non-finite expiry collapses to 0 (never).
 */
export function resolveResetPolicy(
  rolloverInt: number | undefined,
  expiryMonthsInt: number | undefined,
): ResetPolicy {
  const rollover = rolloverInt === undefined ? true : rolloverInt !== 0;
  const rawMonths = expiryMonthsInt ?? 0;
  const expiryMonths = Number.isFinite(rawMonths) && rawMonths > 0 ? Math.trunc(rawMonths) : 0;
  return { rollover, expiryMonths };
}

/**
 * True when a source's window has elapsed and its leftover must expire.
 * rollover=true → never (no reset entry). expiryMonths=0 → never (does not
 * expire). Otherwise the grant expires once `monthsElapsed >= expiryMonths`.
 */
export function shouldExpire(policy: ResetPolicy, monthsElapsed: number): boolean {
  if (policy.rollover) return false;
  if (policy.expiryMonths <= 0) return false;
  return monthsElapsed >= policy.expiryMonths;
}

/**
 * The whole-cent amount to expire = the leftover positive balance. Never expires
 * more than the current balance (an already-spent-down balance loses only what
 * remains) and never a negative amount (a negative balance is left untouched —
 * expiry only claws back UNUSED grant, it never deepens a debt).
 *
 * NOTE: this is the WHOLE-balance helper, kept for the balance-clamp step. Expiry
 * MUST NOT claw the whole unified balance — it claws only the EXPIRING source's
 * own leftover (see sourceLeftoverCents). This helper only exists to floor/clamp a
 * per-source leftover figure to a non-negative whole cent.
 */
export function expiryAmountCents(balanceCents: number): number {
  return balanceCents > 0 ? Math.floor(balanceCents) : 0;
}

/**
 * SOURCE/WINDOW-AWARE leftover: the remaining whole cents of ONE source's own
 * grants, i.e. the net of every ledger row attributed to that source
 * (grant/purchase money-IN minus that source's consumption/expiry money-OUT).
 * This is what may expire for the source — NEVER the whole unified
 * credit_balances (which sums all sources). Clamped to a non-negative whole cent:
 * a source already spent to/below its own zero has nothing to claw back, and
 * expiry never deepens a debt nor touches OTHER sources' funds.
 *
 * Consumption rows carry the spending source's own tag (the charge's `source`),
 * so a spend attributed to `subscription` reduces the subscription leftover and
 * leaves `purchase`/`admin`/`coupon` untouched. This is the D3 unified-model
 * attribution; in D2 live spend is still the legacy rail, which is exactly why
 * expiry ships DORMANT (it must not run against live balances until spend routes
 * through charge() — see the credit-charge.ts expire() header).
 */
export function sourceLeftoverCents(ledger: readonly LedgerRow[], source: string): number {
  let net = 0;
  for (const row of ledger) {
    if (row.source === source) net += row.deltaCents;
  }
  return expiryAmountCents(net);
}

/**
 * Apply an expiry to the pure account model, mirroring the DB single writer:
 *  - replay guard: the deterministic expiry ref_id is claimed once (mirrors the
 *    unique ref_id index) → a second call for the same (user, source, period) is
 *    a total no-op, exactly ONE kind=expiry row.
 *  - rollover=true OR nothing to expire → NO ledger row, balance unchanged.
 *  - otherwise ONE append-only NEGATIVE kind=expiry row = the balance decrement,
 *    keeping balance == SUM(ledger deltas). referenceCents is NOT bumped (expiry
 *    is money-out, not a positive money-in anchor).
 * Mutates and returns the account for ergonomic test sequencing.
 */
export function simulateExpire(
  acct: Account,
  userId: string,
  source: string,
  period: string,
  policy: ResetPolicy,
  monthsElapsed: number,
): Account {
  const refId = expiryRefId(userId, source, period);
  if (acct.chargedRefIds.has(refId)) return acct; // replay → exactly one expiry row
  if (!shouldExpire(policy, monthsElapsed)) return acct; // rollover / not-yet / never
  // SOURCE/WINDOW-AWARE: claw back only THIS source's own leftover, never the whole
  // unified balance — a coexisting purchase/admin/coupon grant is untouched.
  const amount = sourceLeftoverCents(acct.ledger, source);
  if (amount <= 0) return acct; // nothing left to claw back for this source
  acct.chargedRefIds.add(refId);
  acct.ledger.push({ deltaCents: -amount, kind: "expiry", source, refId });
  acct.balanceCents -= amount;
  return acct;
}
