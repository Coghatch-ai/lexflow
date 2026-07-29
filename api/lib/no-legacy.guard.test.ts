// api/lib/no-legacy.guard.test.ts
//
// NO-LEGACY guard (D4, epic #50). The unified credit engine is now the ONLY billing
// system; every legacy/backward-compat/shadow scaffold is DELETED. This test greps
// the whole tracked codebase (excluding design docs + this guard itself) and fails
// if any removed symbol reappears — the deterministic "did legacy sneak back in?"
// check the acceptance calls for.

import { execSync } from "child_process";
import { join } from "path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

// Symbols/tables that must NOT exist anywhere in the code (design/*.md is prose
// history and is excluded — it documents the port, it is not code).
const FORBIDDEN = [
  "allowance_ledger",
  "allowanceLedger",
  "free_daily_counter",
  "freeDailyCounter",
  "CREDIT_COSTS",
  "ALLOWANCE_COST",
  "ledger-debit",
  "debitAllowance",
  "assertAllowance",
  "refundAllowance",
  "assertCoreAction",
  "atomicDebitCredits",
  "atomicDebitAllowance",
  "backfill-credit-balances",
  "credit-backfill",
  "creditBackfill",
  "CREDITS_MODE",
  "creditsMode",
  "credits-mode",
  "isShadow",
  "emitReconcileMetric",
  "LegacyMirror",
  "legacyMirror",
  "legacy_allowance",
];

function grepCount(term: string): string[] {
  // git grep across tracked + untracked SOURCE, excluding: markdown design docs
  // (prose history), *.test.ts (tests legitimately assert the ABSENCE of these
  // terms), and drizzle/meta snapshots (historical migration state — the DROP
  // migration removes the tables; old snapshots are frozen history).
  let out = "";
  try {
    out = execSync(
      `git grep -n --untracked -F -e ${JSON.stringify(term)} -- ` +
        `':!*.md' ':!*.test.ts' ':!drizzle/meta/**' ':!drizzle/0*.sql' || true`,
      { cwd: repoRoot, encoding: "utf-8" },
    );
  } catch {
    out = "";
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe("NO-LEGACY — no removed billing symbol/table reappears in the code", () => {
  for (const term of FORBIDDEN) {
    it(`no reference to \`${term}\``, () => {
      expect(grepCount(term)).toEqual([]);
    });
  }
});
