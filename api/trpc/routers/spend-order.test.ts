// api/trpc/routers/spend-order.test.ts
//
// Regression guards for debit-before-enqueue ordering on the credit rail
// (ai.router tutorAsk + coach.router generate) — issue #55.
// Source-text assertions — no live DB needed.
//
// HONEST LIMIT: index-order text assertions confirm call ordering in source;
// they cannot verify runtime ordering. A true concurrency test requires a live DB.
//
// Guards:
//   R1 — tutorAsk: debitCredits appears BEFORE enqueueRelayJob / enqueueStreamTicket
//   R2 — tutorAsk: refundCredits in enqueue catch block
//   R3 — coach.generate: debitCredits appears BEFORE enqueueRelayJob
//   R4 — coach.generate: refundCredits in enqueue catch block
//   R5 — subscription FOR UPDATE present before periodStart compute

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const aiSrc = readFileSync(join(import.meta.dirname, "ai.router.ts"), "utf-8");
const coachSrc = readFileSync(join(import.meta.dirname, "coach.router.ts"), "utf-8");
const subSrc = readFileSync(join(import.meta.dirname, "../../lib/subscription.ts"), "utf-8");

// ── R1: tutorAsk debit before enqueue ─────────────────────────────────────────
describe("R1 — tutorAsk: atomic debit committed BEFORE enqueue (issue #55 ordering)", () => {
  it("debitCredits call appears before enqueueRelayJob in tutorAsk", () => {
    const tutorStart = aiSrc.indexOf("tutorAsk: protectedProcedure");
    const tutorEnd = aiSrc.indexOf("\n  tutorFinalize:", tutorStart);
    const tutorBody = aiSrc.slice(tutorStart, tutorEnd);

    const debitPos = tutorBody.indexOf("await debitCredits(");
    const enqueueRelayPos = tutorBody.indexOf("await enqueueRelayJob(");
    const enqueueStreamPos = tutorBody.indexOf("await enqueueStreamTicket(");
    const enqueuePos = Math.min(
      enqueueRelayPos > -1 ? enqueueRelayPos : Infinity,
      enqueueStreamPos > -1 ? enqueueStreamPos : Infinity,
    );

    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeLessThan(Infinity); // at least one enqueue present
    // Debit must come before any enqueue call
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("tutorAsk uses mintJobId to pre-mint the debit ref_id", () => {
    const tutorStart = aiSrc.indexOf("tutorAsk: protectedProcedure");
    const tutorEnd = aiSrc.indexOf("\n  tutorFinalize:", tutorStart);
    const tutorBody = aiSrc.slice(tutorStart, tutorEnd);
    expect(tutorBody).toContain("mintJobId()");
  });
});

// ── R2: tutorAsk refund on enqueue failure ────────────────────────────────────
describe("R2 — tutorAsk: refundCredits in enqueue catch block", () => {
  it("refundCredits imported in ai.router.ts", () => {
    expect(aiSrc).toContain("refundCredits");
  });

  it("refundCredits call is inside a catch block wrapping the enqueue", () => {
    const tutorStart = aiSrc.indexOf("tutorAsk: protectedProcedure");
    const tutorEnd = aiSrc.indexOf("\n  tutorFinalize:", tutorStart);
    const tutorBody = aiSrc.slice(tutorStart, tutorEnd);

    // catch block must exist and contain refundCredits
    const catchPos = tutorBody.indexOf("} catch (");
    expect(catchPos).toBeGreaterThan(-1);
    const catchBlock = tutorBody.slice(catchPos);
    expect(catchBlock).toContain("refundCredits(");
  });

  it("debitCredits appears before the try block (not inside it)", () => {
    const tutorStart = aiSrc.indexOf("tutorAsk: protectedProcedure");
    const tutorEnd = aiSrc.indexOf("\n  tutorFinalize:", tutorStart);
    const tutorBody = aiSrc.slice(tutorStart, tutorEnd);

    const debitPos = tutorBody.indexOf("await debitCredits(");
    const tryPos = tutorBody.indexOf("    try {");
    expect(debitPos).toBeGreaterThan(-1);
    expect(tryPos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(tryPos);
  });
});

// ── R3: coach.generate debit before enqueue ───────────────────────────────────
describe("R3 — coach.generate: atomic debit committed BEFORE enqueue (issue #55)", () => {
  it("debitCredits appears before enqueueRelayJob in generate mutation", () => {
    const genStart = coachSrc.indexOf("generate: protectedProcedure");
    const genEnd = coachSrc.indexOf("\n  finalize:", genStart);
    const genBody = coachSrc.slice(genStart, genEnd);

    const debitPos = genBody.indexOf("await debitCredits(");
    const enqueuePos = genBody.indexOf("await enqueueRelayJob(");

    expect(debitPos).toBeGreaterThan(-1);
    expect(enqueuePos).toBeGreaterThan(-1);
    expect(debitPos).toBeLessThan(enqueuePos);
  });

  it("coach.generate uses mintJobId to pre-mint the debit ref_id", () => {
    const genStart = coachSrc.indexOf("generate: protectedProcedure");
    const genEnd = coachSrc.indexOf("\n  finalize:", genStart);
    const genBody = coachSrc.slice(genStart, genEnd);
    expect(genBody).toContain("mintJobId()");
  });
});

// ── R4: coach.generate refund on enqueue failure ──────────────────────────────
describe("R4 — coach.generate: refundCredits in enqueue catch block", () => {
  it("refundCredits imported in coach.router.ts", () => {
    expect(coachSrc).toContain("refundCredits");
  });

  it("refundCredits inside catch block wrapping enqueueRelayJob", () => {
    const genStart = coachSrc.indexOf("generate: protectedProcedure");
    const genEnd = coachSrc.indexOf("\n  finalize:", genStart);
    const genBody = coachSrc.slice(genStart, genEnd);

    const catchPos = genBody.indexOf("} catch (");
    expect(catchPos).toBeGreaterThan(-1);
    const catchBlock = genBody.slice(catchPos);
    expect(catchBlock).toContain("refundCredits(");
  });
});

// ── R5: subscription FOR UPDATE before periodStart ────────────────────────────
describe("R5 — grantSubscriptionImpl: FOR UPDATE on subscription read before period compute", () => {
  it("FOR UPDATE present in subscription.ts", () => {
    expect(subSrc).toContain("FOR UPDATE");
  });

  it("FOR UPDATE appears before periodStart computation", () => {
    const forUpdatePos = subSrc.indexOf("FOR UPDATE");
    const periodStartPos = subSrc.indexOf("let periodStart:");
    expect(forUpdatePos).toBeGreaterThan(-1);
    expect(periodStartPos).toBeGreaterThan(-1);
    expect(forUpdatePos).toBeLessThan(periodStartPos);
  });

  it("FOR UPDATE is inside grantSubscriptionImpl (not outside it)", () => {
    const implStart = subSrc.indexOf("async function grantSubscriptionImpl(");
    const implEnd = subSrc.indexOf("export async function grantSubscription(");
    const implBody = subSrc.slice(implStart, implEnd);
    expect(implBody).toContain("FOR UPDATE");
  });

  it("executor.execute used for FOR UPDATE query (same tx connection)", () => {
    // The FOR UPDATE must run on the same connection as the tx to hold the lock.
    // Using the module-level db outside the tx would not hold the lock.
    expect(subSrc).toContain("executor.execute(sql");
  });

  it("executor type is the money-core CreditTx (a drizzle tx: has .execute)", () => {
    // D2: DbOrTx is now the money-core CreditTx (the drizzle transaction), which
    // exposes .execute for the FOR UPDATE / advisory-lock queries.
    expect(subSrc).toContain("type DbOrTx = CreditTx");
  });
});
