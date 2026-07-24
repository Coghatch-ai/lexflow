// api/lib/credits.test.ts
//
// Regression guards for api/lib/credits.ts — issue #55 credit-rail atomicity.
// Source-text assertions — no live DB needed.
//
// Guards:
//   C1 — debitCredits delegates to atomicDebitCredits (no unconditional insert)
//   C2 — refundCredits present and idempotent (onConflictDoNothing)
//   C3 — grantCredits present (admin path unchanged)
//   C4 — assertCredits kept as thin pre-flight balance read

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(import.meta.dirname, "credits.ts"), "utf-8");

describe("C1 — debitCredits uses atomicDebitCredits (guarded, no two-step race)", () => {
  it("debitCredits is exported", () => {
    expect(src).toContain("export async function debitCredits");
  });

  it("imports atomicDebitCredits from ledger-debit", () => {
    expect(src).toContain("atomicDebitCredits");
    expect(src).toContain('from "./ledger-debit"');
  });

  it("debitCredits body calls atomicDebitCredits, not a raw db.insert", () => {
    const fnStart = src.indexOf("export async function debitCredits");
    const fnEnd = src.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);
    expect(body).toContain("atomicDebitCredits(");
    // No unconditional insert inside debitCredits — that was the two-step race bug.
    expect(body).not.toContain(".insert(");
  });

  it("no standalone onConflictDoNothing inside debitCredits (guard lives in helper)", () => {
    // The old pattern: debitCredits itself called .insert().onConflictDoNothing().
    // After the fix, that logic moved into atomicDebitCredits in ledger-debit.ts.
    const fnStart = src.indexOf("export async function debitCredits");
    const fnEnd = src.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);
    expect(body).not.toContain("onConflictDoNothing");
  });
});

describe("C2 — refundCredits is idempotent via onConflictDoNothing", () => {
  it("refundCredits is exported", () => {
    expect(src).toContain("export async function refundCredits");
  });

  it("refund ref_id is refund:<jobId>", () => {
    expect(src).toContain("`refund:${jobId}`");
  });

  it("refund uses onConflictDoNothing (idempotent)", () => {
    const fnStart = src.indexOf("export async function refundCredits");
    const fnEnd = src.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);
    expect(body).toContain("onConflictDoNothing");
  });

  it("refund is a no-op when spend row absent (early return)", () => {
    expect(src).toContain("if (spend === undefined) return;");
  });
});

describe("C3 — grantCredits present (admin grant path unchanged)", () => {
  it("grantCredits is exported", () => {
    expect(src).toContain("export async function grantCredits");
  });

  it("grant action is admin_grant", () => {
    expect(src).toContain('"admin_grant"');
  });
});

describe("C4 — assertCredits is a thin balance pre-flight (not the atomic guard)", () => {
  it("assertCredits is exported", () => {
    expect(src).toContain("export async function assertCredits");
  });

  it("assertCredits uses getBalance (read-only, no insert)", () => {
    const fnStart = src.indexOf("export async function assertCredits");
    const fnEnd = src.indexOf("\nexport async function ", fnStart + 1);
    const body = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart);
    expect(body).toContain("getBalance(");
    expect(body).not.toContain(".insert(");
  });
});
