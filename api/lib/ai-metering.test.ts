// api/lib/ai-metering.test.ts
//
// D3 (epic #50) — the delivered-only SHADOW metering door. Mixes runtime behavior
// (delivered:false total no-op; reconcile emission; mode rail) with source-text
// guards for the SHADOW-writes-nothing contract (the write path needs a DB, so it
// is proven at the charge() SQL layer via credit-charge.ts text + credit-money's
// hermetic simulate parity, and asserted here at the wiring layer).

import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitReconcileMetric,
  resolveMeteringModel,
  settleDelivered,
  PROD_DEFAULT_MODEL,
} from "./ai-metering";
import { creditsMode, isShadow, isOff } from "./credits-mode";

const repoRoot = join(import.meta.dirname, "..", "..");
const chargeSrc = readFileSync(join(repoRoot, "api/lib/credit-charge.ts"), "utf-8");
const meterSrc = readFileSync(join(import.meta.dirname, "ai-metering.ts"), "utf-8");

/** Parse the single JSON arg of a console.warn spy into a typed record (no `any`). */
function firstWarnPayload(
  warn: ReturnType<typeof vi.spyOn>,
): Record<string, string | number | boolean> {
  const calls = warn.mock.calls as unknown as string[][];
  const arg = calls[0]?.[0] ?? "{}";
  return JSON.parse(arg) as Record<string, string | number | boolean>;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CREDITS_MODE;
});

describe("D3-MODE — CREDITS_MODE env rail", () => {
  it("defaults to shadow when unset (D3 shadow-first)", () => {
    delete process.env.CREDITS_MODE;
    expect(creditsMode()).toBe("shadow");
    expect(isShadow()).toBe(true);
    expect(isOff()).toBe(false);
  });

  it("only exact 'enforce' / 'off' opt out; anything else → shadow", () => {
    process.env.CREDITS_MODE = "enforce";
    expect(creditsMode()).toBe("enforce");
    process.env.CREDITS_MODE = "off";
    expect(creditsMode()).toBe("off");
    process.env.CREDITS_MODE = "garbage";
    expect(creditsMode()).toBe("shadow");
    process.env.CREDITS_MODE = "SHADOW";
    expect(creditsMode()).toBe("shadow");
  });
});

describe("D3-DELIVERED-FALSE — settleDelivered on an undelivered job is a total no-op", () => {
  it("delivered:false → charge() returns no-op WITHOUT opening a tx (no DB touched)", async () => {
    // charge()'s delivered:false guard returns before any DB call, so this runs
    // hermetically. settleDelivered must still emit the reconcile metric (0 vs old).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await settleDelivered({
      userId: "00000000-0000-0000-0000-000000000000",
      source: "grade",
      refId: "grade:job-1",
      model: PROD_DEFAULT_MODEL,
      usage: { kind: "tokens", amount: 2048 },
      delivered: false,
      oldDebitCents: 1,
      action: "grade",
    });
    expect(result?.outcome).toBe("no-op");
    expect(result?.flushCents).toBe(0);
    // Reconcile still emitted (would-charge 0 for an undelivered action).
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = firstWarnPayload(warn);
    expect(payload.metric).toBe("credits-reconcile");
    expect(payload.delivered).toBe(false);
    expect(payload.wouldChargeCents).toBe(0);
  });

  it("OFF mode → settleDelivered returns null, charge never called (kill switch)", async () => {
    process.env.CREDITS_MODE = "off";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await settleDelivered({
      userId: "00000000-0000-0000-0000-000000000000",
      source: "grade",
      refId: "grade:job-2",
      model: PROD_DEFAULT_MODEL,
      usage: { kind: "tokens", amount: 2048 },
      delivered: true, // even a delivered job is skipped entirely in OFF
      oldDebitCents: 1,
      action: "grade",
    });
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("D3-RECONCILE — one structured metric per source/model/action", () => {
  it("emitReconcileMetric writes a single credits-reconcile line via console.warn (never console.log)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    emitReconcileMetric({
      source: "tutor",
      model: "gpt-4o-mini",
      action: "tutorAsk",
      delivered: true,
      shadow: true,
      rawCents: 0.04,
      wouldChargeCents: 0,
      owedCents: 0.04,
      oldDebitCents: 1,
      outcome: "shadow",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const p = firstWarnPayload(warn);
    expect(p).toMatchObject({
      metric: "credits-reconcile",
      source: "tutor",
      model: "gpt-4o-mini",
      action: "tutorAsk",
      oldDebitCents: 1,
      wouldChargeCents: 0,
      deltaCents: -1, // wouldCharge - oldDebit
    });
  });

  it("reconcile metric uses console.warn, NOT console.log (project console ban)", () => {
    expect(meterSrc).toContain("console.warn");
    // No actual console.log CALL (the ban) — match the call form, not the word in a comment.
    expect(meterSrc).not.toMatch(/console\.log\(/);
  });
});

describe("D3-REFID — door refIds respect the reserved-prefix rules", () => {
  it("settleDelivered asserts the caller refId is not reserved (throws on a reserved prefix)", async () => {
    await expect(
      settleDelivered({
        userId: "00000000-0000-0000-0000-000000000000",
        source: "grade",
        refId: "charge:evil", // reserved money-core prefix
        model: PROD_DEFAULT_MODEL,
        usage: { kind: "tokens", amount: 1 },
        delivered: false,
        oldDebitCents: 0,
        action: "grade",
      }),
    ).rejects.toThrow(/reserved ledger prefix/);
  });

  it("the wired door refIds use door-specific, non-reserved prefixes", () => {
    const ai = readFileSync(join(repoRoot, "api/trpc/routers/ai.router.ts"), "utf-8");
    const q = readFileSync(join(repoRoot, "api/trpc/routers/questions.router.ts"), "utf-8");
    const coach = readFileSync(join(repoRoot, "api/trpc/routers/coach.router.ts"), "utf-8");
    const admin = readFileSync(join(repoRoot, "api/trpc/routers/admin.router.ts"), "utf-8");
    expect(ai).toContain("`grade:${input.jobId}`");
    expect(ai).toContain("`tutor:${input.jobId}`");
    expect(q).toContain("`explain:${input.jobId}`");
    expect(coach).toContain("`coach:${input.jobId}`");
    expect(admin).toContain("`explain:admin:${input.jobId}`");
    // None of the door prefixes may collide with a reserved money-core prefix.
    for (const p of ["grade:", "tutor:", "explain:", "coach:", "explain:admin:"]) {
      expect(p.startsWith("charge:")).toBe(false);
      expect(p.startsWith("legacy_allowance:")).toBe(false);
    }
  });
});

describe("D3-SHADOW-ZERO-ROWS — shadow charge() writes NO ledger/charge/balance rows", () => {
  it("charge()'s dryRun branch returns BEFORE the transaction (writes nothing)", () => {
    // The shadow figure is computed from a READ of the bag, then returns { outcome:
    // 'shadow' } — the `db.transaction(...)` write block sits AFTER and below the
    // dryRun early-return, so in shadow no INSERT/UPDATE of credit_charges /
    // credit_ledger / credit_balances is ever reached.
    const dryRunPos = chargeSrc.indexOf("if (dryRun)");
    const txPos = chargeSrc.indexOf("return db.transaction(async (tx)");
    expect(dryRunPos).toBeGreaterThan(-1);
    expect(txPos).toBeGreaterThan(dryRunPos); // tx write block is AFTER the shadow return
    const shadowBranch = chargeSrc.slice(dryRunPos, txPos);
    expect(shadowBranch).toContain('outcome: "shadow"');
    // The shadow branch must not INSERT/UPDATE any money table.
    expect(shadowBranch).not.toMatch(/INSERT INTO credit_/);
    expect(shadowBranch).not.toMatch(/UPDATE credit_/);
  });

  it("settleDelivered passes dryRun=isShadow() so a shadow settle never writes", () => {
    expect(meterSrc).toContain("dryRun: shadow");
    expect(meterSrc).toContain("const shadow = isShadow()");
  });
});

describe("D3-MODEL — resolveMeteringModel", () => {
  it("uses the per-task override when provided, else the prod default", () => {
    expect(resolveMeteringModel("gpt-4o")).toBe("gpt-4o");
    expect(resolveMeteringModel()).toBe(PROD_DEFAULT_MODEL);
    expect(resolveMeteringModel("")).toBe(PROD_DEFAULT_MODEL);
  });
});
