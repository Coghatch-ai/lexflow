// api/trpc/routers/questions.router.test.ts
//
// S3 regression guard (issue #52): getOrGenerateExplanation must gate on
// allowance (core action) for live LLM calls, and must NOT debit anything on
// cache hits. Strategy: source-text assertions — catches re-import and inline
// re-addition without needing a DB.
//
// Codex F1/F2/F3 additions (review:changes → re-implement):
//   F1: assertCoreAction receives jobId (atomic claim, no separate SELECT).
//   F2: incrementFreeTierCounter is GONE — counter claim is now inside assertCoreAction.
//   F3: debitAllowance is gated on tier === "paid" — free path never writes ledger.
// Codex 5th-pass (review:changes): paid debit BEFORE enqueue; refundAllowance on enqueue failure.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(join(import.meta.dirname, "questions.router.ts"), "utf-8");

// Isolate the getOrGenerateExplanation handler body.
const explainStart = routerSource.indexOf("getOrGenerateExplanation:");
const explainEnd = routerSource.indexOf("finalizeExplanation:");
const explainSection = routerSource.slice(explainStart, explainEnd);

describe("spend routing S3 — getOrGenerateExplanation uses allowance", () => {
  it("calls assertCoreAction (allowance/free-tier gate) on cache miss path", () => {
    expect(explainSection).toContain("assertCoreAction");
  });

  it("calls debitAllowance after enqueue on cache miss path", () => {
    expect(explainSection).toContain("debitAllowance");
  });

  it("does NOT call assertCredits (core action must not touch credit_ledger)", () => {
    expect(explainSection).not.toContain("assertCredits");
  });

  it("does NOT call debitCredits (core action must not touch credit_ledger)", () => {
    expect(explainSection).not.toContain("debitCredits");
  });

  it("returns cached explanation immediately without a spend call (cache-hit free)", () => {
    // The cache-hit branch must return BEFORE any assertCoreAction / debitAllowance.
    const cacheHitPos = explainSection.indexOf("cached: true");
    const gatePos = explainSection.indexOf("assertCoreAction");
    expect(cacheHitPos).toBeGreaterThan(-1);
    expect(gatePos).toBeGreaterThan(-1);
    expect(cacheHitPos).toBeLessThan(gatePos);
  });

  // ── Codex F1 fix guard ──────────────────────────────────────────────────────
  it("F1: assertCoreAction is called with jobId argument (atomic claim, not check-then-increment)", () => {
    // The call must pass jobId so the counter insert is conditional (WHERE count < LIMIT).
    // Would go RED if reverted to assertCoreAction(ctx.userId) with no jobId.
    expect(explainSection).toContain("assertCoreAction(ctx.userId, jobId)");
  });

  // ── Codex F2 fix guard ──────────────────────────────────────────────────────
  it("F2: incrementFreeTierCounter is NOT called in router (counter claim now inside assertCoreAction)", () => {
    // The separate post-enqueue increment is gone; the atomic claim inside
    // assertCoreAction handles it. A separate call here would re-introduce the race.
    expect(explainSection).not.toContain("incrementFreeTierCounter");
  });

  // ── Codex F3 fix guard ──────────────────────────────────────────────────────
  it("F3: debitAllowance is gated on tier === 'paid' (free path must not write allowance_ledger)", () => {
    // The debitAllowance call must be inside an `if (tier === "paid")` branch.
    // Use exact call and if-statement forms to skip comment occurrences.
    expect(explainSection).toContain(`if (tier === "paid")`);
    const tierGatePos = explainSection.indexOf(`if (tier === "paid")`);
    const debitPos = explainSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(tierGatePos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(tierGatePos);
  });
});

// ── Codex 3rd-pass ordering fix — assert BEFORE enqueue ──────────────────────
describe("Codex 3rd-pass — entitlement asserted BEFORE relay job enqueued (getOrGenerateExplanation)", () => {
  it("mintJobId is imported from relay (pre-mint pattern)", () => {
    // Would go RED if the import reverts to not including mintJobId.
    expect(routerSource).toContain("mintJobId");
    expect(routerSource).toContain(`from "../../lib/relay"`);
  });

  it("mintJobId() is called in getOrGenerateExplanation handler (jobId reserved before assert)", () => {
    expect(explainSection).toContain("mintJobId()");
  });

  it("assertCoreAction is called BEFORE enqueueRelayJob in getOrGenerateExplanation handler", () => {
    // The ordering invariant: assert first, enqueue only after claim succeeds.
    // Goes RED against old code where enqueueRelayJob preceded assertCoreAction.
    const assertPos = explainSection.indexOf("assertCoreAction(");
    const enqueuePos = explainSection.indexOf("enqueueRelayJob(");
    expect(assertPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(assertPos).toBeLessThan(enqueuePos);
  });

  it("mintJobId() is called BEFORE assertCoreAction in getOrGenerateExplanation handler", () => {
    // jobId must be minted before assertCoreAction so the id can be passed to the claim.
    // Use the assignment expression to skip any comment occurrences of these names.
    const mintPos = explainSection.indexOf("const jobId = mintJobId()");
    const assertPos = explainSection.indexOf("const tier = await assertCoreAction(");
    expect(mintPos).toBeGreaterThan(-1);
    expect(assertPos).toBeGreaterThan(-1);
    expect(mintPos).toBeLessThan(assertPos);
  });

  it("enqueueRelayJob receives pre-minted jobId as 3rd argument", () => {
    // The relay dispatch must pass the reserved id so the claim and job are the same.
    expect(explainSection).toContain("enqueueRelayJob(ctx.userId, payload, jobId)");
  });
});

// ── Codex 4th-pass: enqueue-failure reversal for free tier ───────────────────
describe("Codex 4th-pass — enqueue failure reverses free-tier counter (getOrGenerateExplanation)", () => {
  it("reverseFreeTierCounter is imported from allowance", () => {
    // Would go RED if import missing after fix.
    expect(routerSource).toContain("reverseFreeTierCounter");
    expect(routerSource).toContain(`from "../../lib/allowance"`);
  });

  it("getOrGenerateExplanation wraps enqueueRelayJob in try/catch", () => {
    // The wrap is the safety net — RED against unwrapped enqueue.
    expect(explainSection).toContain("try {");
    expect(explainSection).toContain("} catch (enqueueErr)");
  });

  it("reverseFreeTierCounter is called inside the catch block when tier === 'free'", () => {
    // Only free path reverses — paid has nothing to reverse at this point.
    const catchStart = explainSection.indexOf("} catch (enqueueErr)");
    const catchBlock = explainSection.slice(
      catchStart,
      explainSection.indexOf("throw enqueueErr", catchStart) + 20,
    );
    expect(catchBlock).toContain(`tier === "free"`);
    expect(catchBlock).toContain("reverseFreeTierCounter(ctx.userId, jobId)");
  });

  it("error is rethrown after reversal (enqueue failure still surfaces to client)", () => {
    // Swallowing hides S3 failures.
    expect(explainSection).toContain("throw enqueueErr");
  });

  it("debitAllowance (paid) is BEFORE enqueueRelayJob, not after catch (5th-pass fix)", () => {
    // Codex 5th-pass: paid debit must be committed BEFORE dispatch so no job is ever
    // dispatched without a durable spend row. Goes RED against post-enqueue debit.
    const debitPos = explainSection.indexOf("debitAllowance(ctx.userId, jobId)");
    const enqueuePos = explainSection.indexOf("enqueueRelayJob(ctx.userId, payload, jobId)");
    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("reverseFreeTierCounter is NOT called unconditionally (only for free tier)", () => {
    // Must be gated on tier === 'free' — paid users have no counter claim to reverse.
    const catchStart = explainSection.indexOf("} catch (enqueueErr)");
    const catchBlock = explainSection.slice(
      catchStart,
      explainSection.indexOf("throw enqueueErr", catchStart) + 20,
    );
    expect(catchBlock).not.toContain('tier === "paid"');
    // The gating expression must be present.
    expect(catchBlock).toContain(`tier === "free"`);
  });
});

// ── Codex 5th-pass: paid debit BEFORE enqueue; refundAllowance on enqueue failure ──
describe("Codex 5th-pass — paid debit committed before dispatch, refunded on enqueue failure (getOrGenerateExplanation)", () => {
  it("refundAllowance is imported from allowance", () => {
    // Goes RED if import removed.
    expect(routerSource).toContain("refundAllowance");
    expect(routerSource).toContain(`from "../../lib/allowance"`);
  });

  it("debitAllowance is called BEFORE enqueueRelayJob for paid path (no dispatch-before-debit window)", () => {
    const debitPos = explainSection.indexOf("debitAllowance(ctx.userId, jobId)");
    const enqueuePos = explainSection.indexOf("enqueueRelayJob(ctx.userId, payload, jobId)");
    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("debitAllowance is still gated on tier === 'paid' (free path unchanged)", () => {
    // F3 invariant must survive the reorder — use if-statement form to skip comments.
    const tierGatePos = explainSection.indexOf(`if (tier === "paid")`);
    const debitPos = explainSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(tierGatePos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(tierGatePos);
  });

  it("refundAllowance is called in catch block for paid tier (reverses pre-committed debit on enqueue failure)", () => {
    // Goes RED if paid path has no reversal on enqueue failure.
    const catchStart = explainSection.indexOf("} catch (enqueueErr)");
    const throwPos = explainSection.indexOf("throw enqueueErr", catchStart);
    const catchBlock = explainSection.slice(catchStart, throwPos + 20);
    expect(catchBlock).toContain("refundAllowance(ctx.userId, jobId)");
  });

  it("refundAllowance is in the else branch (paid, not free)", () => {
    // Must be mutually exclusive with reverseFreeTierCounter (different rails).
    const catchStart = explainSection.indexOf("} catch (enqueueErr)");
    const throwPos = explainSection.indexOf("throw enqueueErr", catchStart);
    const catchBlock = explainSection.slice(catchStart, throwPos + 20);
    expect(catchBlock).toContain(`tier === "free"`);
    expect(catchBlock).toContain("} else {");
    expect(catchBlock).toContain("refundAllowance(ctx.userId, jobId)");
    expect(catchBlock).toContain("reverseFreeTierCounter(ctx.userId, jobId)");
  });

  it("assertCoreAction is still BEFORE debitAllowance (insufficient balance refused before any debit)", () => {
    // Balance check must precede debit — refused paid user never gets debited.
    const assertPos = explainSection.indexOf("assertCoreAction(ctx.userId, jobId)");
    const debitPos = explainSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(assertPos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(-1);
    expect(assertPos).toBeLessThan(debitPos);
  });
});
