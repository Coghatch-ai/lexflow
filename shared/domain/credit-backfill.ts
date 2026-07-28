// shared/domain/credit-backfill.ts
//
// PURE planner for the D1 live migration (epic #50). The backfill SCRIPT
// (scripts/backfill-credit-balances.ts) does the I/O; THIS module owns the
// deterministic transformation — the two-rail source map, the merged-ledger
// derivation, and the post-backfill invariant validation — so the migration
// gate ("per-user materialized balance == SUM(merged ledger)") is provable
// hermetically without touching prod. No I/O here.
//
// Two rails merge into ONE canonical credit_ledger (delta_cents + kind + source):
//   credit_ledger (legacy credits):
//     delta > 0, action=admin_grant       → kind=grant,       source=admin
//     delta > 0, action=coupon_grant       → kind=grant,       source=coupon
//     delta > 0, action=refund/other       → kind=grant,       source=legacy
//     delta > 0, action=purchase/top_up    → kind=purchase,    source=purchase
//     delta < 0 (any spend/consumption)    → kind=consumption, source=legacy
//   allowance_ledger (legacy allowance):
//     action=monthly_grant / top_up / grant→ kind=grant,       source=subscription
//     delta < 0 (spend/expire)             → kind=consumption, source=legacy_allowance_consumption
//
// Credits are treated 1:1 as cents at D1 (unit == cent); the price-per-credit
// BRL conversion is a purchase-flow decision, out of scope here. delta_cents for
// a migrated row == its legacy signed delta.
//
// WRITE PLAN (the fix for the two-rail merge actually applying):
//   - credit rail rows ALREADY LIVE in credit_ledger → the merge UPDATEs them in
//     place by their existing ref_id (writeMode "update"). Their canonical
//     ledgerRefId is just their own ref_id.
//   - allowance rail rows live in a SEPARATE table (allowance_ledger) → they have
//     NO credit_ledger row yet, so the merge must INSERT a canonical credit_ledger
//     row (writeMode "insert"). Its ledgerRefId is NAMESPACED
//     `legacy_allowance:<allowanceRowId>` so it is deterministic AND can never
//     collide with a real credit_ledger ref_id or a `charge:` consumption ref_id.
// deriveBalances / validateInvariant sum the deltaCents of the WHOLE merged set
// (both write modes), so the post-write invariant (materialized balance == SUM of
// the actually-written unified credit_ledger) holds for allowance-history users.

import { hasReservedRefPrefix, LEGACY_ALLOWANCE_REF_PREFIX } from "./credit-reserved";

// Re-export so existing importers keep working; canonical definition + the full
// reserved-prefix list live in shared/domain/credit-reserved.ts.
export { LEGACY_ALLOWANCE_REF_PREFIX };

/**
 * PREFLIGHT gate over the ref_ids ALREADY present in credit_ledger before the
 * migration inserts any namespaced row. Returns the ref_ids that already squat a
 * reserved internal prefix (`charge:` / `legacy_allowance:`). A non-empty result
 * MUST abort the backfill: a pre-existing reserved-prefix row would collide with
 * an internal insert (ON CONFLICT DO NOTHING) and silently drop a migrated row.
 */
export function findReservedPrefixRefIds(existingRefIds: readonly (string | null)[]): string[] {
  return existingRefIds.filter(
    (refId): refId is string => refId !== null && hasReservedRefPrefix(refId),
  );
}

/** Deterministic, non-colliding ledger ref_id for a migrated allowance row. */
export function legacyAllowanceRefId(allowanceRowId: string): string {
  return `${LEGACY_ALLOWANCE_REF_PREFIX}${allowanceRowId}`;
}

/** A legacy row from EITHER credit_ledger or allowance_ledger. */
export interface LegacyLedgerRow {
  rail: "credit" | "allowance";
  /** The source row's own PK (allowance_ledger.id / credit_ledger.id). Drives the
   *  deterministic INSERT ref_id for allowance rows; optional for credit rows. */
  id?: string;
  userId: string;
  delta: number;
  action: string;
  refId: string | null;
}

/** How the merge persists a unified row: UPDATE an existing credit_ledger row by
 *  ref_id, or INSERT a brand-new canonical row (allowance rail). */
export type LedgerWriteMode = "update" | "insert";

/** A row in the unified canonical credit_ledger after merge. */
export interface MergedLedgerRow {
  userId: string;
  deltaCents: number;
  kind: "grant" | "purchase" | "refund" | "consumption" | "adjustment" | "expiry";
  source: string;
  /** The RAW legacy ref_id (credit rail) or null (an allowance row may have none). */
  refId: string | null;
  /** The canonical credit_ledger ref_id actually written (namespaced for inserts). */
  ledgerRefId: string;
  /** The source credit_ledger row's PRIMARY KEY (credit rail UPDATEs target this,
   *  NOT the nullable ref_id — a credit row whose ref_id is NULL is still counted by
   *  deriveBalances, so it MUST be updatable; null only for allowance inserts). */
  sourceId: string | null;
  /** UPDATE-in-place (credit rail) vs INSERT-new (allowance rail). */
  writeMode: LedgerWriteMode;
}

// Action tokens that mean "positive money-in of type purchase" on the credit rail.
const PURCHASE_ACTIONS = new Set(["purchase", "top_up", "credit_pack"]);

/**
 * Map a single legacy row to its canonical unified form. Pure + total: the sign
 * of `delta` decides money-in vs money-out; the rail + action pick the source.
 */
export function mapLegacyRow(row: LegacyLedgerRow): MergedLedgerRow {
  if (row.rail === "allowance") {
    // Allowance rows have no credit_ledger row yet → INSERT a canonical one with a
    // deterministic namespaced ref_id (falls back to the row's own ref_id only if
    // it has no id, which real allowance_ledger rows always do).
    const ledgerRefId = legacyAllowanceRefId(
      row.id ?? row.refId ?? `${row.userId}:${String(row.delta)}:${row.action}`,
    );
    const base = {
      userId: row.userId,
      deltaCents: row.delta,
      refId: row.refId,
      ledgerRefId,
      // allowance rows are INSERTed (targeted by the namespaced ref_id), never
      // UPDATEd, so they carry no source PK.
      sourceId: null,
      writeMode: "insert" as const,
    };
    if (row.delta >= 0) {
      // monthly_grant / top_up / grant / any other positive → subscription grant.
      return { ...base, kind: "grant", source: "subscription" };
    }
    return { ...base, kind: "consumption", source: "legacy_allowance_consumption" };
  }
  // credit rail — the row already lives in credit_ledger → UPDATE it in place by
  // its own PRIMARY KEY (id), NOT the ref_id: schema allows a NULL credit_ledger
  // ref_id, and deriveBalances still counts a null-ref_id row, so it must remain
  // targetable. ledgerRefId stays the raw ref_id for reporting only.
  const base = {
    userId: row.userId,
    deltaCents: row.delta,
    refId: row.refId,
    ledgerRefId: row.refId ?? "",
    sourceId: row.id ?? null,
    writeMode: "update" as const,
  };
  if (row.delta < 0) {
    return { ...base, kind: "consumption", source: "legacy" };
  }
  if (PURCHASE_ACTIONS.has(row.action)) {
    return { ...base, kind: "purchase", source: "purchase" };
  }
  if (row.action === "admin_grant") {
    return { ...base, kind: "grant", source: "admin" };
  }
  if (row.action === "coupon_grant") {
    return { ...base, kind: "grant", source: "coupon" };
  }
  return { ...base, kind: "grant", source: "legacy" };
}

/** Map every legacy row across both rails into the unified ledger. */
export function mergeLegacyLedgers(rows: LegacyLedgerRow[]): MergedLedgerRow[] {
  return rows.map(mapLegacyRow);
}

/** Per-user materialized balance derived from the merged ledger (SUM delta_cents). */
export function deriveBalances(merged: MergedLedgerRow[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const row of merged) {
    balances.set(row.userId, (balances.get(row.userId) ?? 0) + row.deltaCents);
  }
  return balances;
}

export interface InvariantMismatch {
  userId: string;
  materializedCents: number;
  ledgerSumCents: number;
}

/**
 * The migration gate. For every user, assert the value we would write into
 * credit_balances.balance_cents equals SUM(merged credit_ledger.delta_cents).
 * Returns the empty array when the invariant holds for all users. The backfill
 * script writes NOTHING when this is non-empty (fail-closed).
 */
export function validateInvariant(
  materialized: Map<string, number>,
  merged: MergedLedgerRow[],
): InvariantMismatch[] {
  const ledgerSums = deriveBalances(merged);
  const users = new Set<string>([...materialized.keys(), ...ledgerSums.keys()]);
  const mismatches: InvariantMismatch[] = [];
  for (const userId of users) {
    const mat = materialized.get(userId) ?? 0;
    const sum = ledgerSums.get(userId) ?? 0;
    if (mat !== sum) {
      mismatches.push({ userId, materializedCents: mat, ledgerSumCents: sum });
    }
  }
  return mismatches;
}
