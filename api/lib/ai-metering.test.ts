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

const repoRoot = join(import.meta.dirname, "..", "..");
const meterSrc = readFileSync(join(import.meta.dirname, "ai-metering.ts"), "utf-8");
const doorPaths = [
  "api/trpc/routers/discursive.router.ts",
  "api/trpc/routers/ai.router.ts",
  "api/trpc/routers/questions.router.ts",
  "api/trpc/routers/coach.router.ts",
  "api/trpc/routers/admin.router.ts",
];
const doorSrc = doorPaths.map((p) => readFileSync(join(repoRoot, p), "utf-8"));

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
    // charge() is handed delivered:true AND the caller's tx (adjacent keys of the
    // same call, whatever the formatter does to the line breaks).
    expect(meterSrc).toMatch(/delivered:\s*true,\s*tx,?\s*[},]/);
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

describe("#98 NO INVENTED INPUTS — no hardcoded token count, no default model", () => {
  it("the fixed-usage constants are GONE from every door", () => {
    // Pre-fix each door declared its own guess: 2048 / 2048 / 2048 / 900 / 1200.
    for (const src of doorSrc) {
      expect(src).not.toMatch(/usage:\s*\{/);
      expect(src).not.toContain("amount:");
      expect(src).not.toContain('kind: "tokens"');
    }
  });

  it("PROD_DEFAULT_MODEL / resolveMeteringModel no longer exist", () => {
    expect(meterSrc).not.toContain("PROD_DEFAULT_MODEL");
    expect(meterSrc).not.toContain("resolveMeteringModel");
    for (const src of doorSrc) expect(src).not.toContain("resolveMeteringModel");
  });

  it("all 5 doors parse the server-read result through parseAiResult", () => {
    for (const src of doorSrc) {
      expect(src).toContain("parseAiResult(job.data)");
      expect(src).toContain("metering:");
      // The raw cast the parse replaced must not creep back in.
      expect(src).not.toContain("job.data as { text: string }");
    }
  });

  it("NO door meters a model taken from the tRPC input (free-call lever)", () => {
    // `grade` may still FORWARD a client provider/model to the relay — what it
    // may never do is let that reach the charge. So the assertion is scoped to
    // the consumeAndCharge argument object: it carries `metering:` and nothing
    // model-shaped of its own.
    for (const src of doorSrc) {
      const start = src.indexOf("consumeAndCharge({");
      expect(start).toBeGreaterThan(0);
      const call = src.slice(start, src.indexOf("});", start));
      expect(call).toContain("metering: meteringOf(ai)");
      expect(call).not.toMatch(/\bmodel:/);
      expect(call).not.toMatch(/\busage:/);
      expect(call).not.toMatch(/input\.(provider|model)/);
    }
  });
});

describe("#98 UNPRICED IS VISIBLE, NOT A REFUSAL", () => {
  it("ai-metering carries both visibility signals (:unmetered source + console.error)", () => {
    expect(meterSrc).toContain(":unmetered");
    expect(meterSrc).toContain("[credits] ai usage indisponível — cobrado 0");
    expect(meterSrc).toMatch(/console\.error\(/);
    expect(meterSrc).not.toMatch(/console\.log\(/);
  });

  it("no door turns an unpriced result into a thrown error", () => {
    for (const src of doorSrc) {
      expect(src).not.toContain("unpriced");
    }
  });

  it("BAD_GATEWAY in the metering door is reachable ONLY for missing text", () => {
    // Exactly ONE thrown BAD_GATEWAY in the whole metering door (prose mentions
    // in comments do not count — match the thrown code literal).
    const gateways = meterSrc.match(/code:\s*"BAD_GATEWAY"/g) ?? [];
    expect(gateways).toHaveLength(1);
    expect(meterSrc).toContain("A IA não retornou uma resposta");
  });
});

describe("#98 review round 1 — the request side is an ALLOWLIST, the poll stays narrow", () => {
  const aiRouterSrc = readFileSync(join(repoRoot, "api/trpc/routers/ai.router.ts"), "utf-8");
  const relayRouterSrc = readFileSync(join(repoRoot, "api/trpc/routers/relay.router.ts"), "utf-8");
  const cogSrc = readFileSync(join(repoRoot, "shared/domain/cost-of-goods.ts"), "utf-8");

  it("grade's `model` input is no longer a free-form string", () => {
    // The pre-round-1 shape `model: z.string().min(1).optional()` let a client
    // name ANY model; an un-priced one delivered real work at 0¢.
    expect(aiRouterSrc).not.toContain("model: z.string().min(1).optional()");
    expect(aiRouterSrc).toContain("requestedModelSchema");
    expect(aiRouterSrc).toContain("isRequestableModel");
  });

  it("the allowlist is enforced by the PRICE TABLE, not a second hand-kept list", () => {
    expect(cogSrc).toContain("export function isRequestableModel");
    // Round 2, blocker 1: EXACT membership of the table — the request door must
    // NOT reuse the metering suffix strip, which would bill a client-named
    // snapshot at its alias's rate. `hasCostRate` here is the regression.
    expect(cogSrc).toContain("return Object.hasOwn(COST_OF_GOODS, model)");
    expect(cogSrc).not.toContain("  return hasCostRate(model);");
  });

  it("pricing resolves the echoed snapshot instead of demanding an exact alias", () => {
    expect(cogSrc).toContain("export function resolveRateModel");
    expect(cogSrc).toContain("SNAPSHOT_SUFFIX");
    // The rejected alternative is documented so it is not "fixed" back later.
    expect(cogSrc).toContain("WHY NOT LONGEST-PREFIX MATCHING");
  });

  it("the poll endpoint projects the result before returning it to the client", () => {
    expect(relayRouterSrc).toContain("clientRelayJobView");
    expect(relayRouterSrc).not.toContain("return getRelayJob(ctx.userId, input.jobId);");
  });
});
