// shared/domain/credit-reserved.test.ts
//
// The reserved credit_ledger.ref_id namespace registry (D1, epic #50). One source
// of truth for the internal prefixes (`charge:`, `legacy_allowance:`) the money
// core owns, plus the guard grant() and the backfill preflight both enforce.

import { describe, expect, it } from "vitest";
import {
  CHARGE_LEDGER_REF_PREFIX,
  LEGACY_ALLOWANCE_REF_PREFIX,
  RESERVED_LEDGER_REF_PREFIXES,
  assertExternalRefId,
  hasReservedRefPrefix,
  matchedReservedRefPrefix,
} from "./credit-reserved";

describe("reserved ledger ref_id prefixes", () => {
  it("the canonical prefixes are exactly charge: and legacy_allowance:", () => {
    expect(CHARGE_LEDGER_REF_PREFIX).toBe("charge:");
    expect(LEGACY_ALLOWANCE_REF_PREFIX).toBe("legacy_allowance:");
    expect([...RESERVED_LEDGER_REF_PREFIXES]).toEqual(["charge:", "legacy_allowance:"]);
  });

  it("the two prefixes cannot shadow each other (distinct namespaces)", () => {
    expect(CHARGE_LEDGER_REF_PREFIX.startsWith(LEGACY_ALLOWANCE_REF_PREFIX)).toBe(false);
    expect(LEGACY_ALLOWANCE_REF_PREFIX.startsWith(CHARGE_LEDGER_REF_PREFIX)).toBe(false);
  });
});

describe("hasReservedRefPrefix", () => {
  it("true for a ref_id in either reserved namespace", () => {
    expect(hasReservedRefPrefix("charge:abc")).toBe(true);
    expect(hasReservedRefPrefix("legacy_allowance:42")).toBe(true);
  });

  it("false for an ordinary caller ref_id (incl. lookalikes that don't start with a prefix)", () => {
    expect(hasReservedRefPrefix("purchase:x")).toBe(false);
    expect(hasReservedRefPrefix("mycharge:x")).toBe(false); // not a PREFIX match
    expect(hasReservedRefPrefix("")).toBe(false);
    expect(hasReservedRefPrefix("A-g1")).toBe(false);
  });
});

describe("matchedReservedRefPrefix", () => {
  it("returns the exact prefix matched, or null", () => {
    expect(matchedReservedRefPrefix("charge:z")).toBe("charge:");
    expect(matchedReservedRefPrefix("legacy_allowance:z")).toBe("legacy_allowance:");
    expect(matchedReservedRefPrefix("clean")).toBeNull();
  });
});

describe("assertExternalRefId — the shared guard every LIVE external ledger writer calls", () => {
  it("throws, naming the writer + the reserved prefix, on a charge:-prefixed refId", () => {
    expect(() => {
      assertExternalRefId("charge:evil", "grantCredits()");
    }).toThrow(/grantCredits\(\).*reserved ledger prefix "charge:"/);
  });

  it("throws on a legacy_allowance:-prefixed refId", () => {
    expect(() => {
      assertExternalRefId("legacy_allowance:x", "coupon redeem");
    }).toThrow(/reserved ledger prefix "legacy_allowance:"/);
  });

  it("accepts an ordinary caller refId (incl. lookalikes) and a null refId", () => {
    expect(() => {
      assertExternalRefId("admin:abc", "grantCredits()");
    }).not.toThrow();
    expect(() => {
      assertExternalRefId("coupon:PROMO:u1", "coupon redeem");
    }).not.toThrow();
    expect(() => {
      assertExternalRefId("mycharge:x", "grantCredits()");
    }).not.toThrow();
    expect(() => {
      assertExternalRefId(null, "grantCredits()");
    }).not.toThrow();
  });
});
