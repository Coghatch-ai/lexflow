// shared/domain/credit-reserved.ts
//
// RESERVED credit_ledger.ref_id namespaces (epic #50). credit_ledger.ref_id is a
// GLOBAL key shared by every writer: charge consumption rows + grant/purchase/
// refund rows. To keep those writers from colliding on the same raw ref_id (which
// would let a fail-loud paired insert no-op and roll back a legitimate write), the
// money core NAMESPACES its own internal consumption rows:
//   - a charge consumption row → `charge:<rawRefId>` (credit-charge.ts)
//
// This prefix is RESERVED: no EXTERNAL caller (grant()/coupon/admin) may write a
// ref_id that begins with it, or it could shadow a later internal row and break the
// `balance == SUM(delta)` invariant. This module is the SINGLE source of truth for
// the reserved list + the guard the money core (grant reject) enforces. Pure, no I/O.

/** Namespace for a charge's consumption ledger ref_id (`charge:<rawRefId>`). */
export const CHARGE_LEDGER_REF_PREFIX = "charge:";

/**
 * Every prefix the internal money core owns. An external caller's ref_id that
 * starts with any of these is REJECTED (grant).
 */
export const RESERVED_LEDGER_REF_PREFIXES = [CHARGE_LEDGER_REF_PREFIX] as const;

/**
 * True when a raw ref_id begins with a reserved internal namespace. Used to reject
 * a caller-supplied grant ref_id.
 */
export function hasReservedRefPrefix(refId: string): boolean {
  return RESERVED_LEDGER_REF_PREFIXES.some((prefix) => refId.startsWith(prefix));
}

/** The reserved prefix a ref_id matches, or null. For a precise error message. */
export function matchedReservedRefPrefix(refId: string): string | null {
  return RESERVED_LEDGER_REF_PREFIXES.find((prefix) => refId.startsWith(prefix)) ?? null;
}

/**
 * Guard for EVERY live credit_ledger writer that takes an EXTERNAL/caller-supplied
 * ref_id (grant()/grantCredits/coupon redeem/admin/refund-of-external, …). Throws
 * when the refId squats a reserved internal namespace (`charge:`), which would let
 * a later internal fail-loud paired insert no-op and roll back a legitimate write
 * (breaking `balance == SUM(delta)`). `writer` names the call site for a precise
 * error. INTERNAL owners (charge() writing `charge:<x>`) must NOT call this — they
 * legitimately own the prefix. A null refId is allowed (no ref = nothing to collide).
 */
export function assertExternalRefId(refId: string | null, writer: string): void {
  if (refId === null) return;
  const reservedPrefix = matchedReservedRefPrefix(refId);
  if (reservedPrefix !== null) {
    throw new Error(
      `${writer} refId "${refId}" uses the reserved ledger prefix "${reservedPrefix}" — ` +
        "reserved namespaces are internal to the money core (charge/backfill); pick another refId.",
    );
  }
}
