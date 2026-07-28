// shared/domain/credit-backfill.test.ts
//
// D1 migration-gate suite (epic #50). Proves the two-rail merge source map and
// the post-backfill invariant — per-user materialized balance == SUM(merged
// ledger.delta_cents) — hermetically, over simulated existing users, without
// touching prod. The backfill SCRIPT is a thin I/O wrapper over these functions.

import { describe, expect, it } from "vitest";
import {
  mapLegacyRow,
  mergeLegacyLedgers,
  deriveBalances,
  validateInvariant,
  legacyAllowanceRefId,
  findReservedPrefixRefIds,
  LEGACY_ALLOWANCE_REF_PREFIX,
  type LegacyLedgerRow,
  type MergedLedgerRow,
} from "./credit-backfill";
import { CHARGE_LEDGER_REF_PREFIX } from "./credit-reserved";

describe("mapLegacyRow — two-rail source map", () => {
  it("credit rail: admin_grant → grant/admin, coupon_grant → grant/coupon", () => {
    expect(
      mapLegacyRow({ rail: "credit", userId: "u", delta: 500, action: "admin_grant", refId: "a" }),
    ).toMatchObject({ kind: "grant", source: "admin", deltaCents: 500 });
    expect(
      mapLegacyRow({ rail: "credit", userId: "u", delta: 300, action: "coupon_grant", refId: "b" }),
    ).toMatchObject({ kind: "grant", source: "coupon" });
  });

  it("credit rail: purchase/top_up → purchase/purchase; other positive → grant/legacy", () => {
    expect(
      mapLegacyRow({ rail: "credit", userId: "u", delta: 900, action: "top_up", refId: "c" }),
    ).toMatchObject({
      kind: "purchase",
      source: "purchase",
    });
    expect(
      mapLegacyRow({ rail: "credit", userId: "u", delta: 100, action: "mystery", refId: "d" }),
    ).toMatchObject({
      kind: "grant",
      source: "legacy",
    });
  });

  it("credit rail: any negative → consumption/legacy", () => {
    expect(
      mapLegacyRow({ rail: "credit", userId: "u", delta: -2, action: "tutor", refId: "e" }),
    ).toMatchObject({
      kind: "consumption",
      source: "legacy",
    });
  });

  it("allowance rail: monthly_grant → grant/subscription; spend → consumption/legacy_allowance_consumption", () => {
    expect(
      mapLegacyRow({
        rail: "allowance",
        userId: "u",
        delta: 30,
        action: "monthly_grant",
        refId: "f",
      }),
    ).toMatchObject({ kind: "grant", source: "subscription" });
    expect(
      mapLegacyRow({ rail: "allowance", userId: "u", delta: -1, action: "spend", refId: "g" }),
    ).toMatchObject({
      kind: "consumption",
      source: "legacy_allowance_consumption",
    });
  });

  it("allowance rows are INSERTs with a deterministic namespaced ledger ref_id", () => {
    // The D1 bug: allowance rows must MATERIALIZE new canonical credit_ledger rows
    // (writeMode "insert"), not update a nonexistent credit_ledger row by ref_id.
    const grant = mapLegacyRow({
      rail: "allowance",
      id: "aw-1",
      userId: "u",
      delta: 30,
      action: "monthly_grant",
      refId: "f",
    });
    expect(grant.writeMode).toBe("insert");
    expect(grant.ledgerRefId).toBe(legacyAllowanceRefId("aw-1"));
    expect(grant.ledgerRefId.startsWith(LEGACY_ALLOWANCE_REF_PREFIX)).toBe(true);

    const spend = mapLegacyRow({
      rail: "allowance",
      id: "aw-2",
      userId: "u",
      delta: -1,
      action: "spend",
      refId: "g",
    });
    expect(spend.writeMode).toBe("insert");
    expect(spend.ledgerRefId).toBe(legacyAllowanceRefId("aw-2"));
  });

  it("credit rows are UPDATEs targeting the source PRIMARY KEY (sourceId), not the nullable ref_id", () => {
    const row = mapLegacyRow({
      rail: "credit",
      id: "cl-9",
      userId: "u",
      delta: 500,
      action: "admin_grant",
      refId: "a",
    });
    expect(row.writeMode).toBe("update");
    expect(row.sourceId).toBe("cl-9"); // the UPDATE target — the row's own PK
    expect(row.ledgerRefId).toBe("a"); // reporting only; NOT the write key
  });

  it("r2 #2: a credit row with a NULL ref_id still carries its PK and is counted+targetable", () => {
    // Regression: schema allows NULL credit_ledger.ref_id; deriveBalances counts the
    // row, so it MUST be UPDATE-targetable by PK. Keying on ref_id (null) would skip
    // it → post-write mismatch. sourceId (the PK) is the write key.
    const row = mapLegacyRow({
      rail: "credit",
      id: "cl-nullref",
      userId: "u",
      delta: -250,
      action: "spend",
      refId: null,
    });
    expect(row.writeMode).toBe("update");
    expect(row.sourceId).toBe("cl-nullref");
    expect(row.refId).toBeNull();
    expect(row.deltaCents).toBe(-250);
    // deriveBalances counts it → the plan MUST be able to target it (by PK).
    expect(deriveBalances([row]).get("u")).toBe(-250);
  });

  it("allowance rows carry no source PK (they are INSERTs, targeted by namespaced ref_id)", () => {
    const row = mapLegacyRow({
      rail: "allowance",
      id: "aw-9",
      userId: "u",
      delta: 30,
      action: "monthly_grant",
      refId: null,
    });
    expect(row.writeMode).toBe("insert");
    expect(row.sourceId).toBeNull();
    expect(row.ledgerRefId).toBe(legacyAllowanceRefId("aw-9"));
  });

  it("allowance ledger ref_ids can never collide with the `charge:` consumption namespace", () => {
    // Cross-namespace safety: charge engine writes `charge:<refId>`; allowance
    // backfill writes `legacy_allowance:<id>`. Distinct prefixes → no collision.
    expect(LEGACY_ALLOWANCE_REF_PREFIX.startsWith("charge:")).toBe(false);
    expect(legacyAllowanceRefId("x")).not.toContain("charge:");
  });
});

describe("apply write-plan parity — allowance history materializes into the unified ledger", () => {
  // Simulate the SCRIPT's actual write plan in memory: credit rows UPDATE their
  // existing credit_ledger row; allowance rows INSERT a NEW canonical row. The
  // post-write invariant is checked against the ACTUALLY-WRITTEN unified ledger
  // (the union of updated credit rows + inserted allowance rows), proving the
  // fix: a user WITH allowance history no longer breaks materialized == SUM.

  interface WrittenLedgerRow {
    userId: string;
    deltaCents: number;
    refId: string;
  }

  // Mirror runWritePlan()'s row emission: what lands in credit_ledger after apply.
  function writtenLedger(merged: MergedLedgerRow[]): WrittenLedgerRow[] {
    return merged.map((r) => ({
      userId: r.userId,
      deltaCents: r.deltaCents,
      refId: r.ledgerRefId,
    }));
  }

  // user-E: allowance-ONLY history (a monthly grant + a spend) — the exact case
  // the old apply dropped (it never INSERTed these into credit_ledger).
  const legacy: LegacyLedgerRow[] = [
    {
      rail: "allowance",
      id: "E-aw-1",
      userId: "user-E",
      delta: 30,
      action: "monthly_grant",
      refId: null,
    },
    { rail: "allowance", id: "E-aw-2", userId: "user-E", delta: -4, action: "spend", refId: null },
    // user-F: MIXED — a live credit grant (UPDATE) + allowance grant + spend (INSERT).
    {
      rail: "credit",
      id: "F-cl-1",
      userId: "user-F",
      delta: 1000,
      action: "admin_grant",
      refId: "F-g1",
    },
    {
      rail: "allowance",
      id: "F-aw-1",
      userId: "user-F",
      delta: 30,
      action: "monthly_grant",
      refId: null,
    },
    { rail: "allowance", id: "F-aw-2", userId: "user-F", delta: -2, action: "spend", refId: null },
  ];

  it("materialized balance == SUM(actually-written unified ledger) for allowance-history users", () => {
    const merged = mergeLegacyLedgers(legacy);
    const materialized = deriveBalances(merged);
    const written = writtenLedger(merged);

    // Every allowance row produced a distinct INSERT ref_id (nothing dropped).
    const inserts = merged.filter((r) => r.writeMode === "insert");
    expect(inserts).toHaveLength(4);
    expect(new Set(inserts.map((r) => r.ledgerRefId)).size).toBe(4);

    // Post-write invariant against the WRITTEN rows, per user.
    const writtenSum = new Map<string, number>();
    for (const w of written)
      writtenSum.set(w.userId, (writtenSum.get(w.userId) ?? 0) + w.deltaCents);
    for (const [userId, bal] of materialized) {
      expect(bal).toBe(writtenSum.get(userId));
    }
    expect(materialized.get("user-E")).toBe(26); // 30 - 4, was silently 0 before the fix
    expect(materialized.get("user-F")).toBe(1028); // 1000 + 30 - 2
  });

  it("validateInvariant passes on the merged set including allowance INSERTs", () => {
    const merged = mergeLegacyLedgers(legacy);
    const materialized = deriveBalances(merged);
    expect(validateInvariant(materialized, merged)).toEqual([]);
  });
});

describe("backfill invariant gate — materialized balance == SUM(merged ledger)", () => {
  // Simulated existing users spanning both rails, positive + negative flows.
  const legacy: LegacyLedgerRow[] = [
    { rail: "credit", userId: "user-A", delta: 1000, action: "admin_grant", refId: "A-g1" },
    { rail: "credit", userId: "user-A", delta: -2, action: "tutor", refId: "A-s1" },
    { rail: "credit", userId: "user-A", delta: -2, action: "coach", refId: "A-s2" },
    { rail: "allowance", userId: "user-A", delta: 30, action: "monthly_grant", refId: "A-a1" },
    { rail: "allowance", userId: "user-A", delta: -1, action: "spend", refId: "A-a2" },
    { rail: "credit", userId: "user-B", delta: 500, action: "coupon_grant", refId: "B-g1" },
    // user-C: allowance-only.
    { rail: "allowance", userId: "user-C", delta: 30, action: "monthly_grant", refId: "C-a1" },
    { rail: "allowance", userId: "user-C", delta: -1, action: "spend", refId: "C-a2" },
    // user-D: net-negative (spends exceed grants) → real negative balance.
    { rail: "credit", userId: "user-D", delta: 1, action: "coupon_grant", refId: "D-g1" },
    { rail: "credit", userId: "user-D", delta: -5, action: "coach", refId: "D-s1" },
  ];

  it("derives the expected per-user balances", () => {
    const balances = deriveBalances(mergeLegacyLedgers(legacy));
    expect(balances.get("user-A")).toBe(1000 - 2 - 2 + 30 - 1); // 1025
    expect(balances.get("user-B")).toBe(500);
    expect(balances.get("user-C")).toBe(29);
    expect(balances.get("user-D")).toBe(-4); // negative kept real
  });

  it("validateInvariant passes when materialized == merged sum for every user", () => {
    const merged = mergeLegacyLedgers(legacy);
    const materialized = deriveBalances(merged);
    expect(validateInvariant(materialized, merged)).toEqual([]);
  });

  it("validateInvariant FLAGS a user whose materialized balance drifts", () => {
    const merged = mergeLegacyLedgers(legacy);
    const materialized = deriveBalances(merged);
    materialized.set("user-B", 999); // corrupt one balance
    const mismatches = validateInvariant(materialized, merged);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      userId: "user-B",
      materializedCents: 999,
      ledgerSumCents: 500,
    });
  });
});

describe("r2 #3: findReservedPrefixRefIds — backfill preflight", () => {
  it("returns empty when no pre-existing ref_id squats a reserved prefix", () => {
    expect(findReservedPrefixRefIds(["a", "b-ref", null, "purchase:x", ""])).toEqual([]);
  });

  it("flags a pre-existing `charge:`-prefixed ref_id (would collide with a real charge row)", () => {
    const offenders = findReservedPrefixRefIds(["ok", `${CHARGE_LEDGER_REF_PREFIX}abc`, null]);
    expect(offenders).toEqual([`${CHARGE_LEDGER_REF_PREFIX}abc`]);
  });

  it("flags a pre-existing `legacy_allowance:`-prefixed ref_id", () => {
    const offenders = findReservedPrefixRefIds([legacyAllowanceRefId("aw-1"), "clean"]);
    expect(offenders).toEqual([legacyAllowanceRefId("aw-1")]);
  });

  it("flags MULTIPLE squatters across both reserved namespaces, skips nulls", () => {
    const offenders = findReservedPrefixRefIds([
      `${CHARGE_LEDGER_REF_PREFIX}1`,
      null,
      legacyAllowanceRefId("2"),
      "fine",
    ]);
    expect(offenders).toHaveLength(2);
    expect(offenders).toContain(`${CHARGE_LEDGER_REF_PREFIX}1`);
    expect(offenders).toContain(legacyAllowanceRefId("2"));
  });
});
