// api/lib/ai-metering.test.ts
//
// The metering door (D4, epic #50) — AUTHORITATIVE (no shadow). Runtime behavior for
// resolveMeteringModel + source-text guards for the no-legacy contract. The atomic
// consume+charge write path needs a DB, so it is proven at the SQL layer via
// credit-charge.ts + credit-money's hermetic simulate parity + the unit test in
// ai-metering.consume.test.ts; this file asserts the wiring layer.
//
// Codex #61 round 4: settleDelivered + its best-effort charge-LOST/setTimeout retry are
// REMOVED — all 5 persisted-AI doors now route through consumeAndCharge (single-use
// marker + charge in the caller's tx), so there is no persist-before-settle window to
// retry-recover. This file's charge-LOST/scheduleChargeRetry tests are gone with it.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resolveMeteringModel, PROD_DEFAULT_MODEL } from "./ai-metering";

const repoRoot = join(import.meta.dirname, "..", "..");
const meterSrc = readFileSync(join(import.meta.dirname, "ai-metering.ts"), "utf-8");

describe("NO-LEGACY — no shadow/dryRun/reconcile/oldDebit rail survives", () => {
  it("ai-metering has no shadow mode, no reconcile metric, no oldDebit", () => {
    expect(meterSrc).not.toContain("dryRun");
    expect(meterSrc).not.toContain("isShadow");
    expect(meterSrc).not.toContain("emitReconcileMetric");
    expect(meterSrc).not.toContain("oldDebitCents");
    expect(meterSrc).not.toContain("credits-mode");
    expect(meterSrc).not.toContain("CREDITS_MODE");
  });

  it("uses console.warn/error, NOT console.log (project console ban)", () => {
    expect(meterSrc).not.toMatch(/console\.log\(/);
  });
});

describe("NO SPLIT-SETTLE — the removed best-effort charge-LOST retry stays gone", () => {
  it("settleDelivered + its setTimeout retry machinery are absent from the source", () => {
    // Codex #61 round 4: no persisted-AI door persists before charging any more, so the
    // delivered-but-unsettled window (and its in-memory retry) is gone. A reappearance
    // would re-open the atomicity hole — assert it stays deleted.
    expect(meterSrc).not.toContain("settleDelivered");
    expect(meterSrc).not.toContain("scheduleChargeRetry");
    expect(meterSrc).not.toContain("retryChargeOnce");
    expect(meterSrc).not.toContain("setTimeout");
    expect(meterSrc).not.toContain("charge-LOST");
  });
});

describe("ATOMIC — every persisted-AI door routes through consumeAndCharge in one tx", () => {
  it("consumeAndCharge is exported and charges INSIDE the caller's tx", () => {
    // The marker claim + charge run on `params.tx`, so the caller's persist joins them
    // in ONE atomic unit (charge failure rolls the whole thing back — not swallowed).
    expect(meterSrc).toContain("export async function consumeAndCharge");
    expect(meterSrc).toContain("delivered: true, tx");
  });

  it("all 5 doors bind a target and settle via consumeAndCharge (no bare settle)", () => {
    const discursive = readFileSync(
      join(repoRoot, "api/trpc/routers/discursive.router.ts"),
      "utf-8",
    );
    const ai = readFileSync(join(repoRoot, "api/trpc/routers/ai.router.ts"), "utf-8");
    const q = readFileSync(join(repoRoot, "api/trpc/routers/questions.router.ts"), "utf-8");
    const coach = readFileSync(join(repoRoot, "api/trpc/routers/coach.router.ts"), "utf-8");
    const admin = readFileSync(join(repoRoot, "api/trpc/routers/admin.router.ts"), "utf-8");
    for (const src of [discursive, ai, q, coach, admin]) {
      expect(src).toContain("consumeAndCharge");
      expect(src).not.toContain("settleDelivered");
    }
    // Each door's refId stays door-specific + non-reserved.
    expect(discursive).toContain("`grade:${gradeJobId}`");
    expect(ai).toContain("`tutor:${input.jobId}`");
    expect(q).toContain("`explain:${input.jobId}`");
    expect(coach).toContain("`coach:${input.jobId}`");
    expect(admin).toContain("`explain:admin:${jobId}`");
    for (const p of ["grade:", "tutor:", "explain:", "coach:", "explain:admin:"]) {
      expect(p.startsWith("charge:")).toBe(false);
    }
  });
});

describe("MODEL — resolveMeteringModel", () => {
  it("uses the per-task override when provided, else the prod default", () => {
    expect(resolveMeteringModel("gpt-4o")).toBe("gpt-4o");
    expect(resolveMeteringModel()).toBe(PROD_DEFAULT_MODEL);
    expect(resolveMeteringModel("")).toBe(PROD_DEFAULT_MODEL);
  });
});
