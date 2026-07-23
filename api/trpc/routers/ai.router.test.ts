// api/trpc/routers/ai.router.test.ts
//
// Regression guards for ai.router.ts.
//
// S1 guard (issue #49): assertAndIncrementQuota must be absent.
// S3 guard (issue #52): grade must use allowance rail, NOT credit rail.
// Codex F1/F2/F3 additions (review:changes → re-implement):
//   F1: assertCoreAction receives jobId (atomic claim).
//   F2: incrementFreeTierCounter absent from grade handler (claim inside assertCoreAction).
//   F3: debitAllowance gated on tier === "paid" (free never writes ledger).
// Codex 5th-pass (review:changes): paid debit BEFORE enqueue; refundAllowance on enqueue failure.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(join(import.meta.dirname, "ai.router.ts"), "utf-8");

// ── S1: Quota retirement (issue #49) ─────────────────────────────────────────
describe("quota retirement (S1) — ai.router call-site guard", () => {
  it("assertAndIncrementQuota is not imported or called in ai.router.ts", () => {
    expect(routerSource).not.toContain("assertAndIncrementQuota");
  });

  it("assertAndIncrementQuota is not imported from ai-quota in ai.router.ts", () => {
    expect(routerSource).not.toContain("ai-quota");
  });

  it("assertCredits is present (tutor credits gate is active)", () => {
    expect(routerSource).toContain("assertCredits");
  });
});

// ── S3: Grade moved off credits onto allowance (issue #52) ───────────────────
describe("spend routing S3 — grade uses allowance, not credit_ledger", () => {
  it("grade handler does NOT call assertCredits", () => {
    const gradeSection = routerSource.slice(
      routerSource.indexOf("grade: protectedProcedure"),
      routerSource.indexOf("tutorAsk: protectedProcedure"),
    );
    expect(gradeSection).not.toContain("assertCredits");
  });

  it("grade handler does NOT call debitCredits", () => {
    const gradeSection = routerSource.slice(
      routerSource.indexOf("grade: protectedProcedure"),
      routerSource.indexOf("tutorAsk: protectedProcedure"),
    );
    expect(gradeSection).not.toContain("debitCredits");
  });

  it("grade handler calls assertCoreAction (allowance/free-tier gate)", () => {
    const gradeSection = routerSource.slice(
      routerSource.indexOf("grade: protectedProcedure"),
      routerSource.indexOf("tutorAsk: protectedProcedure"),
    );
    expect(gradeSection).toContain("assertCoreAction");
  });

  it("grade handler calls debitAllowance", () => {
    const gradeSection = routerSource.slice(
      routerSource.indexOf("grade: protectedProcedure"),
      routerSource.indexOf("tutorAsk: protectedProcedure"),
    );
    expect(gradeSection).toContain("debitAllowance");
  });

  it("tutorAsk handler still uses assertCredits (non-core stays on credits)", () => {
    const tutorSection = routerSource.slice(routerSource.indexOf("tutorAsk: protectedProcedure"));
    expect(tutorSection).toContain("assertCredits");
  });

  it("tutorAsk handler still uses debitCredits (non-core stays on credits)", () => {
    const tutorSection = routerSource.slice(routerSource.indexOf("tutorAsk: protectedProcedure"));
    expect(tutorSection).toContain("debitCredits");
  });

  it("allowance import is present (assertCoreAction + debitAllowance imported)", () => {
    expect(routerSource).toContain("assertCoreAction");
    expect(routerSource).toContain("debitAllowance");
  });

  it("grade does NOT import or call assertCredits with 'grade' action string", () => {
    expect(routerSource).not.toContain(`assertCredits(ctx.userId, "grade")`);
  });

  it("grade does NOT call debitCredits with 'grade' action string", () => {
    expect(routerSource).not.toContain(`debitCredits(ctx.userId, "grade"`);
  });
});

// ── Codex F1/F2/F3 guards (review:changes → re-implement) ────────────────────
describe("Codex findings F1/F2/F3 — grade handler atomic/isolated free-tier", () => {
  const gradeSection = routerSource.slice(
    routerSource.indexOf("grade: protectedProcedure"),
    routerSource.indexOf("tutorAsk: protectedProcedure"),
  );

  it("F1: assertCoreAction called with jobId (atomic counter claim, not check-then-increment)", () => {
    // Would go RED if reverted to assertCoreAction(ctx.userId) with no jobId.
    expect(gradeSection).toContain("assertCoreAction(ctx.userId, jobId)");
  });

  it("F2: incrementFreeTierCounter is NOT in grade handler (claim now inside assertCoreAction)", () => {
    // Separate post-enqueue increment removed; atomic claim handles it.
    expect(gradeSection).not.toContain("incrementFreeTierCounter");
  });

  it("F3: debitAllowance is gated on tier === 'paid' (free path must not write allowance_ledger)", () => {
    // Free-tier spends must never appear in allowance_ledger so paid balance stays clean.
    // Use the full if-statement form to skip comment occurrences of the string.
    expect(gradeSection).toContain(`if (tier === "paid")`);
    const tierGatePos = gradeSection.indexOf(`if (tier === "paid")`);
    const debitPos = gradeSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(debitPos).toBeGreaterThan(tierGatePos);
  });
});

// ── Codex 3rd-pass ordering fix — assert BEFORE enqueue ──────────────────────
describe("Codex 3rd-pass — entitlement asserted BEFORE relay job enqueued (grade)", () => {
  const gradeSection = routerSource.slice(
    routerSource.indexOf("grade: protectedProcedure"),
    routerSource.indexOf("tutorAsk: protectedProcedure"),
  );

  it("mintJobId is imported from relay (pre-mint pattern)", () => {
    // Would go RED if the import reverts to not including mintJobId.
    expect(routerSource).toContain("mintJobId");
    expect(routerSource).toContain(`from "../../lib/relay"`);
  });

  it("mintJobId() is called in grade handler (jobId reserved before assert)", () => {
    expect(gradeSection).toContain("mintJobId()");
  });

  it("assertCoreAction is called BEFORE enqueueRelayJob in grade handler", () => {
    // The ordering invariant: assert first, enqueue only after claim succeeds.
    // Goes RED against old code where enqueueRelayJob preceded assertCoreAction.
    const assertPos = gradeSection.indexOf("assertCoreAction(");
    const enqueuePos = gradeSection.indexOf("enqueueRelayJob(");
    expect(assertPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(assertPos).toBeLessThan(enqueuePos);
  });

  it("mintJobId() is called BEFORE assertCoreAction in grade handler", () => {
    // jobId must be minted before assertCoreAction so the id can be passed to the claim.
    const mintPos = gradeSection.indexOf("mintJobId()");
    const assertPos = gradeSection.indexOf("assertCoreAction(");
    expect(mintPos).toBeGreaterThan(-1);
    expect(assertPos).toBeGreaterThan(-1);
    expect(mintPos).toBeLessThan(assertPos);
  });

  it("enqueueRelayJob receives pre-minted jobId as 3rd argument", () => {
    // The relay dispatch must pass the reserved id so the claim and job are the same.
    expect(gradeSection).toContain("enqueueRelayJob(ctx.userId, payload, jobId)");
  });
});

// ── Codex 4th-pass: enqueue-failure reversal for free tier ───────────────────
describe("Codex 4th-pass — enqueue failure reverses free-tier counter (grade)", () => {
  const gradeSection = routerSource.slice(
    routerSource.indexOf("grade: protectedProcedure"),
    routerSource.indexOf("tutorAsk: protectedProcedure"),
  );

  it("reverseFreeTierCounter is imported from allowance", () => {
    // Would go RED if the import is missing after the fix.
    expect(routerSource).toContain("reverseFreeTierCounter");
    expect(routerSource).toContain(`from "../../lib/allowance"`);
  });

  it("grade handler wraps enqueueRelayJob in try/catch", () => {
    // The wrap is the safety net — RED against unwrapped enqueue.
    expect(gradeSection).toContain("try {");
    expect(gradeSection).toContain("} catch (enqueueErr)");
  });

  it("reverseFreeTierCounter is called inside the catch block when tier === 'free'", () => {
    // Only the free path reverses — paid has nothing to reverse at this point.
    const catchStart = gradeSection.indexOf("} catch (enqueueErr)");
    const catchBlock = gradeSection.slice(
      catchStart,
      gradeSection.indexOf("throw enqueueErr", catchStart) + 20,
    );
    expect(catchBlock).toContain(`tier === "free"`);
    expect(catchBlock).toContain("reverseFreeTierCounter(ctx.userId, jobId)");
  });

  it("error is rethrown after reversal (enqueue failure still surfaces as BAD_GATEWAY)", () => {
    // Swallowing the error would hide S3 failures from the client.
    expect(gradeSection).toContain("throw enqueueErr");
  });

  it("debitAllowance (paid) is BEFORE enqueueRelayJob, not after catch (5th-pass fix)", () => {
    // Codex 5th-pass: paid debit must be committed BEFORE dispatch so no job is ever
    // dispatched without a durable spend row. Goes RED against post-enqueue debit.
    const debitPos = gradeSection.indexOf("debitAllowance(ctx.userId, jobId)");
    const enqueuePos = gradeSection.indexOf("enqueueRelayJob(ctx.userId, payload, jobId)");
    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("reverseFreeTierCounter is NOT called for paid tier (no free counter to reverse)", () => {
    // The reversal must be gated on tier === 'free' — paid users have no counter claim.
    const catchStart = gradeSection.indexOf("} catch (enqueueErr)");
    const catchBlock = gradeSection.slice(
      catchStart,
      gradeSection.indexOf("throw enqueueErr", catchStart) + 20,
    );
    // The only reverseFreeTierCounter call is inside the tier === "free" branch.
    expect(catchBlock).not.toContain('tier === "paid"');
  });
});

// ── Codex 5th-pass: paid debit BEFORE enqueue; refundAllowance on enqueue failure ──
describe("Codex 5th-pass — paid debit committed before dispatch, refunded on enqueue failure (grade)", () => {
  const gradeSection = routerSource.slice(
    routerSource.indexOf("grade: protectedProcedure"),
    routerSource.indexOf("tutorAsk: protectedProcedure"),
  );

  it("refundAllowance is imported from allowance", () => {
    // Goes RED if import removed.
    expect(routerSource).toContain("refundAllowance");
    expect(routerSource).toContain(`from "../../lib/allowance"`);
  });

  it("debitAllowance is called BEFORE enqueueRelayJob for paid path (no dispatch-before-debit window)", () => {
    // The invariant: debit row must exist before S3 PutObject fires.
    const debitPos = gradeSection.indexOf("debitAllowance(ctx.userId, jobId)");
    const enqueuePos = gradeSection.indexOf("enqueueRelayJob(ctx.userId, payload, jobId)");
    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("debitAllowance is still gated on tier === 'paid' (free path unchanged)", () => {
    // F3 invariant must survive the reorder — use if-statement form to skip comments.
    const tierGatePos = gradeSection.indexOf(`if (tier === "paid")`);
    const debitPos = gradeSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(tierGatePos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(tierGatePos);
  });

  it("refundAllowance is called in catch block for paid tier (reverses pre-committed debit on enqueue failure)", () => {
    // Goes RED if paid path has no reversal on enqueue failure.
    const catchStart = gradeSection.indexOf("} catch (enqueueErr)");
    const throwPos = gradeSection.indexOf("throw enqueueErr", catchStart);
    const catchBlock = gradeSection.slice(catchStart, throwPos + 20);
    expect(catchBlock).toContain("refundAllowance(ctx.userId, jobId)");
  });

  it("refundAllowance is in the else branch (paid, not free)", () => {
    // Must be mutually exclusive with reverseFreeTierCounter (different rails).
    const catchStart = gradeSection.indexOf("} catch (enqueueErr)");
    const throwPos = gradeSection.indexOf("throw enqueueErr", catchStart);
    const catchBlock = gradeSection.slice(catchStart, throwPos + 20);
    // Both reversal branches present; else separates them.
    expect(catchBlock).toContain(`tier === "free"`);
    expect(catchBlock).toContain("} else {");
    expect(catchBlock).toContain("refundAllowance(ctx.userId, jobId)");
    expect(catchBlock).toContain("reverseFreeTierCounter(ctx.userId, jobId)");
  });

  it("assertCoreAction is still BEFORE debitAllowance (insufficient balance refused before any debit)", () => {
    // Balance check must precede debit — refused paid user never gets debited.
    const assertPos = gradeSection.indexOf("assertCoreAction(ctx.userId, jobId)");
    const debitPos = gradeSection.indexOf("debitAllowance(ctx.userId, jobId)");
    expect(assertPos).toBeGreaterThan(-1);
    expect(debitPos).toBeGreaterThan(-1);
    expect(assertPos).toBeLessThan(debitPos);
  });
});
