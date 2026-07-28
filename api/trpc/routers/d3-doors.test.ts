// api/trpc/routers/d3-doors.test.ts
//
// D3 (epic #50) — wiring guard for the 5 AI doors moved onto admission-read +
// delivered-only SHADOW charge(). Also a REGRESSION guard that the OLD
// debit-at-admission rail is UNCHANGED (it stays authoritative this slice — the
// new path only observes; enforce flip is D4).

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf-8");

const ai = read("api/trpc/routers/ai.router.ts");
const questions = read("api/trpc/routers/questions.router.ts");
const coach = read("api/trpc/routers/coach.router.ts");
const admin = read("api/trpc/routers/admin.router.ts");

describe("D3-DOORS — admission-read wired at every AI door (observe-only)", () => {
  it("grade + tutorAsk read the unified balance at admission", () => {
    expect(ai).toContain("admissionRead(ctx.userId)");
  });
  it("getOrGenerateExplanation reads at admission", () => {
    expect(questions).toContain("admissionRead(ctx.userId)");
  });
  it("coach.generate reads at admission", () => {
    expect(coach).toContain("admissionRead(ctx.userId)");
  });
  it("admin.generateExplanation (formerly UNMETERED) reads at admission", () => {
    expect(admin).toContain("admissionRead(ctx.userId)");
  });
});

describe("D3-DOORS — delivered-only settle wired at every door's delivery-known point", () => {
  it("grade → gradeSettle, tutor → tutorFinalize both settle with distinct sources", () => {
    expect(ai).toContain('source: "grade"');
    expect(ai).toContain('source: "tutor"');
    expect(ai).toContain("settleDelivered({");
  });
  it("explanation settles in finalizeExplanation", () => {
    expect(questions).toContain('source: "explanation"');
    expect(questions).toContain("settleDelivered({");
  });
  it("coach settles in finalize", () => {
    expect(coach).toContain('source: "coach"');
    expect(coach).toContain("settleDelivered({");
  });
  it("admin explanation is now METERED via settleGeneration (Codex)", () => {
    expect(admin).toContain("settleGeneration");
    expect(admin).toContain("settleDelivered({");
  });
});

describe("D3-REGRESSION — OLD debit-at-admission rail is UNCHANGED (still authoritative)", () => {
  it("grade / explanation keep assertCoreAction + debitAllowance (paid) intact", () => {
    expect(ai).toContain("assertCoreAction(ctx.userId, jobId)");
    expect(ai).toContain("debitAllowance(ctx.userId, jobId)");
    expect(questions).toContain("assertCoreAction(ctx.userId, jobId)");
    expect(questions).toContain("debitAllowance(ctx.userId, jobId)");
  });
  it("tutor / coach keep assertCredits + debitCredits intact", () => {
    expect(ai).toContain('assertCredits(ctx.userId, "tutor")');
    expect(ai).toContain('debitCredits(ctx.userId, "tutor"');
    expect(coach).toContain('assertCredits(ctx.userId, "coach")');
    expect(coach).toContain('debitCredits(ctx.userId, "coach"');
  });
  it("the new charge() path is NOT made authoritative — no admission deny added", () => {
    // settleDelivered never throws a FORBIDDEN into a door; admission stays on the
    // old rail. The new path only calls admissionRead (a read) + settleDelivered.
    for (const src of [ai, questions, coach, admin]) {
      expect(src).not.toContain("charge-LOST"); // D4 concept, must not appear yet
    }
  });
});
