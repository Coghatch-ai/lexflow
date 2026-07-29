// shared/domain/credit-reserved.test.ts
//
// The reserved credit_ledger.ref_id namespace registry (epic #50). One source of
// truth for the internal prefix (`charge:`) the money core owns, plus the guard
// grant() enforces. (D4 no-legacy: the `legacy_allowance:` backfill prefix is gone.)

import { describe, expect, it } from "vitest";
import {
  CHARGE_LEDGER_REF_PREFIX,
  RESERVED_LEDGER_REF_PREFIXES,
  assertExternalRefId,
  hasReservedRefPrefix,
  matchedReservedRefPrefix,
} from "./credit-reserved";

describe("reserved ledger ref_id prefixes", () => {
  it("the canonical reserved prefix is exactly charge: (no legacy backfill prefix)", () => {
    expect(CHARGE_LEDGER_REF_PREFIX).toBe("charge:");
    expect([...RESERVED_LEDGER_REF_PREFIXES]).toEqual(["charge:"]);
  });
});

describe("hasReservedRefPrefix", () => {
  it("true for a ref_id in the reserved namespace", () => {
    expect(hasReservedRefPrefix("charge:abc")).toBe(true);
  });

  it("false for an ordinary caller ref_id (incl. lookalikes that don't start with the prefix)", () => {
    expect(hasReservedRefPrefix("purchase:x")).toBe(false);
    expect(hasReservedRefPrefix("mycharge:x")).toBe(false); // not a PREFIX match
    expect(hasReservedRefPrefix("legacy_allowance:42")).toBe(false); // no longer reserved
    expect(hasReservedRefPrefix("")).toBe(false);
    expect(hasReservedRefPrefix("A-g1")).toBe(false);
  });
});

describe("matchedReservedRefPrefix", () => {
  it("returns the exact prefix matched, or null", () => {
    expect(matchedReservedRefPrefix("charge:z")).toBe("charge:");
    expect(matchedReservedRefPrefix("clean")).toBeNull();
  });
});

describe("assertExternalRefId — the shared guard every LIVE external ledger writer calls", () => {
  it("throws, naming the writer + the reserved prefix, on a charge:-prefixed refId", () => {
    expect(() => {
      assertExternalRefId("charge:evil", "grantCredits()");
    }).toThrow(/grantCredits\(\).*reserved ledger prefix "charge:"/);
  });

  it("accepts an ordinary caller refId (incl. lookalikes, the now-unreserved legacy_allowance:, and null)", () => {
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
      assertExternalRefId("legacy_allowance:x", "grantCredits()"); // no longer reserved (D4)
    }).not.toThrow();
    expect(() => {
      assertExternalRefId(null, "grantCredits()");
    }).not.toThrow();
  });
});
