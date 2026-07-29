// api/trpc/routers/ai-door-settlement.test.ts
//
// PER-DOOR SETTLEMENT GUARD (Codex #61). Every AI door that admits + delivers work
// MUST reach the money core charge() on the REAL delivery/consume path — never via a
// separate optional client-called settle proc (that is what left grade + admin
// generateExplanation FREE: their charge lived in an inert `ai.gradeSettle` /
// `admin.questions.settleGeneration` that no client ever called).
//
// ROUND 3 (Codex, review:changes twice): moving settlement server-side wasn't enough —
// the billing anchor (jobId) was still client-OPTIONAL, so AI output could be persisted
// with NO charge by omitting/forging the jobId. The contract is now:
//
//   Persisting AI-generated output REQUIRES a server-verified jobId. The consume proc
//   re-reads the relay job (scoped to ctx.userId), REJECTS unless it is `done`+owned,
//   DERIVES the persisted content from the relay result (never client-asserted), then
//   settles exactly once (idempotent by refId). A missing/random/pending/foreign jobId
//   → REJECTED with NO AI fields persisted and NO charge.
//
// Guard layers:
//  1. BEHAVIORAL: drive the real consume/persist procs through a tRPC caller with db +
//     relay mocked and settleDelivered spied. Assert (a) a valid done+owned job persists
//     AND settles once with the server model + door refId; (b) MISSING jobId → no settle
//     (grade) / rejected (admin AI path); (c) a not-done (pending) or foreign job → the
//     call REJECTS and does NOT settle; (d) a second persist of the same jobId reuses the
//     same refId (charge() idempotent → no double-charge).
//  2. SOURCE-TEXT (all 5 doors): the settle for each door lives inside the same
//     finalize/persist proc that consumes the relay result, and the inert procs are GONE.

import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// --- db mock: a chainable stub covering every call the consume procs make --------
// insert().values().returning() → [{id}]; update().set().where().returning() → [{id}];
// select().from().where().limit() → [row]. Every builder method returns the same
// thenable/chainable object so any chain shape resolves. The select row carries the
// question fields the consume procs read (options/correctAnswer for admin, maxPoints
// for grade).
const selectRow = {
  options: ["A", "B", "C", "D"],
  correctAnswer: "A",
  maxPoints: 10,
};
function chainable(): Record<string, unknown> {
  const rows = [{ id: "11111111-1111-1111-1111-111111111111", ...selectRow }];
  const obj: Record<string, unknown> = {};
  const passthrough = (): Record<string, unknown> => obj;
  for (const m of [
    "values",
    "set",
    "where",
    "from",
    "innerJoin",
    "orderBy",
    "limit",
    "groupBy",
    "having",
    "onConflictDoUpdate",
    "onConflictDoNothing",
    "selectDistinct",
  ]) {
    obj[m] = passthrough;
  }
  obj["returning"] = (): typeof rows => rows;
  // Awaiting a query (e.g. `await db.update(...).set(...).where(...)`) resolves to rows.
  obj["then"] = (resolve: (v: typeof rows) => unknown): unknown => resolve(rows);
  return obj;
}
// A tx handle mirrors db's entry builders (insert/update/select) so a persist run on
// the tx resolves against the same chainable stub.
function txHandle(): Record<string, unknown> {
  return {
    insert: (): Record<string, unknown> => chainable(),
    update: (): Record<string, unknown> => chainable(),
    select: (): Record<string, unknown> => chainable(),
  };
}
vi.mock("../../db/client", () => {
  const db = {
    insert: (): Record<string, unknown> => chainable(),
    update: (): Record<string, unknown> => chainable(),
    select: (): Record<string, unknown> => chainable(),
    selectDistinct: (): Record<string, unknown> => chainable(),
    // The AI-graded paths now persist + consume + charge in ONE tx (Codex #61
    // round 3). The tx handle exposes the SAME query builders as db (insert/update/
    // select), so the persist inside the tx resolves in this mock.
    transaction: (fn: (tx: unknown) => unknown): unknown => fn(txHandle()),
  };
  return { db, query: vi.fn() };
});

// --- relay mock: the delivered relay result the consume proc re-reads server-side --
// getRelayJob is per-user scoped in prod (results/{userId}/{jobId}.json). The mock
// mirrors that: a job is only `done` for its OWNER; any other (userId,jobId) → pending
// (exactly what a missing/foreign/random result object looks like). Tests register the
// owned done jobs they expect via `ownJob(userId, jobId, data)`.
import type { RelayJobStatus } from "../../lib/relay";
const doneJobs = new Map<string, unknown>();
function ownJob(userId: string, jobId: string, data: unknown): void {
  doneJobs.set(`${userId}:${jobId}`, data);
}
vi.mock("../../lib/relay", () => ({
  getRelayJob: vi.fn(async (userId: string, jobId: string): Promise<RelayJobStatus> => {
    const data = doneJobs.get(`${userId}:${jobId}`);
    if (data === undefined) return { status: "pending" }; // missing/random/foreign
    return { status: "done", data };
  }),
  enqueueRelayJob: vi.fn(async () => "job"),
  mintJobId: vi.fn(() => "job"),
}));

// --- metering spy: the SOLE spend path. Never let it actually charge (no DB). ------
// The AI-graded doors now settle via consumeAndCharge (single-use marker + charge in
// the caller's tx). Spy it so no real DB write happens; default "first" = the normal
// first-consume path (persist proceeds).
import * as metering from "../../lib/ai-metering";
const consumeSpy = vi.spyOn(metering, "consumeAndCharge").mockResolvedValue("first" as const);

import { appRouter } from "../router";
import { PROD_DEFAULT_MODEL } from "../../lib/ai-metering";

const JOB = "22222222-2222-4222-8222-222222222222";
const RANDOM_JOB = "99999999-9999-4999-8999-999999999999";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";

// The relay result the consume proc parses. Grade → {score,feedback} JSON; admin
// explanation → the 4-pillar JSON (parseExplainResponse).
const GRADE_RESULT = { text: JSON.stringify({ score: 8, feedback: "bom argumento" }) };
const EXPLAIN_RESULT = {
  text: JSON.stringify({
    whyCorrect: "porque sim",
    whyWrong: { B: "erra", C: "erra", D: "erra" },
    memoryTip: "lembre disso",
    commonTraps: "cuidado com X",
  }),
};
// Tutor → parseTutorResponse accepts either JSON {answer} or plain text.
const TUTOR_RESULT = { text: JSON.stringify({ answer: "explico assim" }) };
// Coach → parseCoachResponse wants a CoachDigest JSON (diagnosis/priorities/actions).
const COACH_RESULT = {
  text: JSON.stringify({
    diagnosis: "foco em civil",
    priorities: [{ discipline: "Direito Civil", reason: "acurácia baixa", severity: "alta" }],
    actions: [{ title: "Revisar contratos", detail: "faça 10 questões" }],
  }),
};

function caller(role: "user" | "admin", userId: string = USER) {
  return appRouter.createCaller({ userId, externalUserId: "ext", role });
}

beforeEach(() => {
  doneJobs.clear();
});
afterEach(() => {
  consumeSpy.mockClear();
  consumeSpy.mockResolvedValue("first" as const);
});

describe("GRADE DOOR — server-verified job required; grade derived, never client-asserted", () => {
  it("valid done+owned job: DERIVES the grade, persists, settles ONCE with server model + grade:<jobId>", async () => {
    ownJob(USER, JOB, GRADE_RESULT);
    const res = await caller("user").discursive.saveAnswer({
      questionId: "q1",
      answerText: "resposta",
      gradeJobId: JOB,
    });
    // Grade is server-derived from the relay result, not client input.
    expect(res.aiScore).toBe(8);
    expect(res.aiFeedback).toBe("bom argumento");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const arg = consumeSpy.mock.calls[0]?.[0];
    expect(arg?.source).toBe("grade");
    expect(arg?.refId).toBe(`grade:${JOB}`);
    expect(arg?.jobId).toBe(JOB);
    expect(arg?.targetId).toBe("q1"); // marker BOUND to the graded question
    expect(arg?.model).toBe(PROD_DEFAULT_MODEL); // server-derived, never client input
  });

  it("MISSING gradeJobId → manual save, NO AI fields persisted, NO settlement", async () => {
    const res = await caller("user").discursive.saveAnswer({
      questionId: "q1",
      answerText: "só self-score",
      selfScore: 5,
    });
    expect(res.aiScore).toBeNull();
    expect(res.aiFeedback).toBeNull();
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("RANDOM/pending jobId (no done result) → REJECTED, nothing persisted, NO settlement", async () => {
    // RANDOM_JOB was never registered as done for USER → getRelayJob returns pending.
    await expect(
      caller("user").discursive.saveAnswer({
        questionId: "q1",
        answerText: "resposta",
        gradeJobId: RANDOM_JOB,
      }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("FOREIGN jobId (done for another user) → REJECTED for the caller, NO settlement", async () => {
    ownJob(OTHER_USER, JOB, GRADE_RESULT); // done, but owned by OTHER_USER
    await expect(
      caller("user", USER).discursive.saveAnswer({
        questionId: "q1",
        answerText: "resposta",
        gradeJobId: JOB,
      }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("a SECOND persist of the same jobId reuses the SAME refId (charge() idempotent → no double-charge)", async () => {
    ownJob(USER, JOB, GRADE_RESULT);
    await caller("user").discursive.saveAnswer({
      answerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      questionId: "q1",
      answerText: "resposta",
      gradeJobId: JOB,
    });
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    expect(consumeSpy.mock.calls[0]?.[0]?.refId).toBe(`grade:${JOB}`);
  });
});

// Codex #61 round 3 — single-use job binding + atomic persist. consumeAndCharge is
// spied here to drive the proc's branch (its own DB-level single-use/atomic logic is
// unit-tested in api/lib/ai-metering.consume.test.ts). These assert the DOOR wires it
// correctly: a rejected replay bubbles up (nothing persisted), a same-target replay
// returns the already-persisted grade without a second consume/charge.
describe("GRADE DOOR — one job backs one output (replay across targets rejected)", () => {
  it("REPLAY onto a DIFFERENT target → consumeAndCharge REJECTS (CONFLICT) → the call throws, nothing extra persisted", async () => {
    ownJob(USER, JOB, GRADE_RESULT);
    // A different target for the same jobId → the marker's target_id mismatch makes
    // consumeAndCharge throw CONFLICT (rolls back the tx → no persist, no charge).
    consumeSpy.mockRejectedValueOnce(
      new TRPCError({ code: "CONFLICT", message: "já foi consumida por outro registro" }),
    );
    await expect(
      caller("user").discursive.saveAnswer({
        questionId: "q-OTHER",
        answerText: "resposta",
        gradeJobId: JOB,
      }),
    ).rejects.toThrow(/consumida/);
  });

  it("REPLAY onto the SAME target → idempotent: returns the graded score, consume/charge happens ONCE", async () => {
    ownJob(USER, JOB, GRADE_RESULT);
    // Second consume of the same (job, question) → "replay": persist + charge already
    // committed on the first call; the proc must NOT re-persist and must still return
    // the server-derived grade.
    consumeSpy.mockResolvedValueOnce("replay" as const);
    const res = await caller("user").discursive.saveAnswer({
      answerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      questionId: "q1",
      answerText: "resposta",
      gradeJobId: JOB,
    });
    expect(res.aiScore).toBe(8);
    expect(res.aiFeedback).toBe("bom argumento");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ADMIN EXPLAIN DOOR — server-verified job required; explanation derived, never client-asserted", () => {
  const explanation = {
    whyCorrect: "porque sim",
    whyWrong: { B: "erra", C: "erra", D: "erra" },
    memoryTip: "lembre disso",
    commonTraps: "cuidado com X",
  };

  it("valid done+owned job: DERIVES the explanation, persists, settles ONCE with server model + explain:admin:<jobId>", async () => {
    ownJob(USER, JOB, EXPLAIN_RESULT);
    await caller("admin").admin.questions.saveAiExplanation({
      id: "q1",
      explanation,
      jobId: JOB,
    });
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const arg = consumeSpy.mock.calls[0]?.[0];
    expect(arg?.source).toBe("explanation");
    expect(arg?.refId).toBe(`explain:admin:${JOB}`);
    expect(arg?.jobId).toBe(JOB);
    expect(arg?.targetId).toBe("q1"); // marker BOUND to the explained question
    expect(arg?.model).toBe(PROD_DEFAULT_MODEL);
  });

  it("MISSING jobId on the AI path → REJECTED, NO settlement (jobId is mandatory for generated output)", async () => {
    await expect(
      caller("admin").admin.questions.saveAiExplanation({ id: "q1", explanation }),
    ).rejects.toThrow(/jobId/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("RANDOM/pending jobId (no done result) → REJECTED, nothing persisted, NO settlement", async () => {
    await expect(
      caller("admin").admin.questions.saveAiExplanation({
        id: "q1",
        explanation,
        jobId: RANDOM_JOB,
      }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("FOREIGN jobId (done for another user) → REJECTED for the caller, NO settlement", async () => {
    ownJob(OTHER_USER, JOB, EXPLAIN_RESULT);
    await expect(
      caller("admin", USER).admin.questions.saveAiExplanation({
        id: "q1",
        explanation,
        jobId: JOB,
      }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("explicit MANUAL edit path (manual:true, no jobId) → persists client text, NO settlement", async () => {
    await caller("admin").admin.questions.saveAiExplanation({
      id: "q1",
      explanation,
      manual: true,
    });
    expect(consumeSpy).not.toHaveBeenCalled();
  });
});

// ── Codex #61 round 4: the OTHER 3 doors, same atomic pattern ──────────────────
// user-facing explanation (questions.finalizeExplanation), tutor (ai.tutorFinalize),
// coach (coach.finalize) now each route through consumeAndCharge (single-use marker
// bound to the door's target + charge in the caller's tx). consumeAndCharge is spied
// (its DB-level single-use/atomic logic is unit-tested in ai-metering.consume.test.ts);
// these assert each DOOR wires it: valid job consumes once bound to the right target;
// missing/random/foreign job rejected (NO consume); replay-diff-target bubbles the
// CONFLICT (nothing extra persisted); replay-same-target idempotent (consume ONCE).

describe("EXPLANATION DOOR (user) — finalizeExplanation binds the job to input.id, atomic", () => {
  it("valid done+owned job: DERIVES explanation, consumes ONCE bound to input.id, server model", async () => {
    ownJob(USER, JOB, EXPLAIN_RESULT);
    const res = await caller("user").questions.finalizeExplanation({ id: "q1", jobId: JOB });
    expect(res.explanation.whyCorrect).toBe("porque sim");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const arg = consumeSpy.mock.calls[0]?.[0];
    expect(arg?.source).toBe("explanation");
    expect(arg?.refId).toBe(`explain:${JOB}`);
    expect(arg?.jobId).toBe(JOB);
    expect(arg?.targetId).toBe("q1"); // marker BOUND to the explained question
    expect(arg?.model).toBe(PROD_DEFAULT_MODEL);
  });

  it("RANDOM/pending jobId → REJECTED, no consume", async () => {
    await expect(
      caller("user").questions.finalizeExplanation({ id: "q1", jobId: RANDOM_JOB }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("FOREIGN jobId (done for another user) → REJECTED for the caller, no consume", async () => {
    ownJob(OTHER_USER, JOB, EXPLAIN_RESULT);
    await expect(
      caller("user", USER).questions.finalizeExplanation({ id: "q1", jobId: JOB }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("REPLAY onto a DIFFERENT question → consumeAndCharge REJECTS (CONFLICT) → call throws", async () => {
    ownJob(USER, JOB, EXPLAIN_RESULT);
    consumeSpy.mockRejectedValueOnce(
      new TRPCError({ code: "CONFLICT", message: "já foi consumida por outro registro" }),
    );
    await expect(
      caller("user").questions.finalizeExplanation({ id: "q-OTHER", jobId: JOB }),
    ).rejects.toThrow(/consumida/);
  });

  it("REPLAY onto the SAME question → idempotent: returns explanation, consume happens ONCE", async () => {
    ownJob(USER, JOB, EXPLAIN_RESULT);
    consumeSpy.mockResolvedValueOnce("replay" as const);
    const res = await caller("user").questions.finalizeExplanation({ id: "q1", jobId: JOB });
    expect(res.explanation.whyCorrect).toBe("porque sim");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("TUTOR DOOR — tutorFinalize binds the job to input.questionId, atomic append", () => {
  it("valid done+owned job: DERIVES the reply, consumes ONCE bound to questionId, server model", async () => {
    ownJob(USER, JOB, TUTOR_RESULT);
    const res = await caller("user").ai.tutorFinalize({ questionId: "q1", jobId: JOB });
    expect(res.answer).toBe("explico assim");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const arg = consumeSpy.mock.calls[0]?.[0];
    expect(arg?.source).toBe("tutor");
    expect(arg?.refId).toBe(`tutor:${JOB}`);
    expect(arg?.jobId).toBe(JOB);
    expect(arg?.targetId).toBe("q1"); // marker BOUND to the tutor thread's question
    expect(arg?.model).toBe(PROD_DEFAULT_MODEL);
  });

  it("RANDOM/pending jobId → REJECTED, no consume", async () => {
    await expect(
      caller("user").ai.tutorFinalize({ questionId: "q1", jobId: RANDOM_JOB }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("FOREIGN jobId → REJECTED for the caller, no consume", async () => {
    ownJob(OTHER_USER, JOB, TUTOR_RESULT);
    await expect(
      caller("user", USER).ai.tutorFinalize({ questionId: "q1", jobId: JOB }),
    ).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("REPLAY onto a DIFFERENT question → CONFLICT bubbles → no second assistant turn", async () => {
    ownJob(USER, JOB, TUTOR_RESULT);
    consumeSpy.mockRejectedValueOnce(
      new TRPCError({ code: "CONFLICT", message: "já foi consumida por outro registro" }),
    );
    await expect(
      caller("user").ai.tutorFinalize({ questionId: "q-OTHER", jobId: JOB }),
    ).rejects.toThrow(/consumida/);
  });

  it("REPLAY onto the SAME question → idempotent: returns the reply, consume ONCE (no re-append)", async () => {
    ownJob(USER, JOB, TUTOR_RESULT);
    consumeSpy.mockResolvedValueOnce("replay" as const);
    const res = await caller("user").ai.tutorFinalize({ questionId: "q1", jobId: JOB });
    expect(res.answer).toBe("explico assim");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("COACH DOOR — finalize binds the job to a single-digest-per-job target, atomic", () => {
  it("valid done+owned job: DERIVES the digest, consumes ONCE bound to the jobId target, server model", async () => {
    ownJob(USER, JOB, COACH_RESULT);
    const res = await caller("user").coach.finalize({ jobId: JOB });
    expect(res.digest.diagnosis).toBe("foco em civil");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    const arg = consumeSpy.mock.calls[0]?.[0];
    expect(arg?.source).toBe("coach");
    expect(arg?.refId).toBe(`coach:${JOB}`);
    expect(arg?.jobId).toBe(JOB);
    expect(arg?.targetId).toBe(JOB); // single-digest-per-job stable target
    expect(arg?.model).toBe(PROD_DEFAULT_MODEL);
  });

  it("RANDOM/pending jobId → REJECTED, no consume", async () => {
    await expect(caller("user").coach.finalize({ jobId: RANDOM_JOB })).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("FOREIGN jobId → REJECTED for the caller, no consume", async () => {
    ownJob(OTHER_USER, JOB, COACH_RESULT);
    await expect(caller("user", USER).coach.finalize({ jobId: JOB })).rejects.toThrow(/andamento/);
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("REPLAY of the same jobId → idempotent: consume ONCE, NO second digest inserted", async () => {
    // Same coach job → same jobId target → "replay": digest already inserted + charged
    // on the first call; the door must NOT insert a second digest.
    ownJob(USER, JOB, COACH_RESULT);
    consumeSpy.mockResolvedValueOnce("replay" as const);
    const res = await caller("user").coach.finalize({ jobId: JOB });
    expect(res.digest.diagnosis).toBe("foco em civil");
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("NO SEPARATE/INERT SETTLE PROC survives (the free-AI hole is closed)", () => {
  it("ai.gradeSettle and admin.questions.settleGeneration are REMOVED from the router tree", () => {
    // appRouter._def.procedures is the flat dotted-path map of every registered
    // procedure. A lingering optional settle door here would re-open the free-AI hole.
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })
      ._def.procedures;
    const paths = Object.keys(procedures);
    expect(paths).not.toContain("ai.gradeSettle");
    expect(paths).not.toContain("admin.questions.settleGeneration");
    // The consume/persist procs that now carry settlement ARE present.
    expect(paths).toContain("discursive.saveAnswer");
    expect(paths).toContain("admin.questions.saveAiExplanation");
  });
});

describe("ALL 5 DOORS — settle lives inside the real consume/persist proc (source contract)", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const read = (p: string): string => readFileSync(join(root, p), "utf-8");

  it("each door's settleDelivered refId is wired on its consume path", () => {
    // grade → discursive.saveAnswer (moved off the deleted ai.gradeSettle)
    expect(read("api/trpc/routers/discursive.router.ts")).toContain("`grade:${gradeJobId}`");
    // explanation (user) → questions.finalizeExplanation
    expect(read("api/trpc/routers/questions.router.ts")).toContain("`explain:${input.jobId}`");
    // tutor → ai.tutorFinalize
    expect(read("api/trpc/routers/ai.router.ts")).toContain("`tutor:${input.jobId}`");
    // coach → coach.finalize
    expect(read("api/trpc/routers/coach.router.ts")).toContain("`coach:${input.jobId}`");
    // admin.generateExplanation → admin.saveAiExplanation (moved off deleted settleGeneration)
    expect(read("api/trpc/routers/admin.router.ts")).toContain("`explain:admin:${jobId}`");
  });

  it("the deleted inert procs are absent from source too", () => {
    expect(read("api/trpc/routers/ai.router.ts")).not.toContain("gradeSettle:");
    expect(read("api/trpc/routers/admin.router.ts")).not.toContain("settleGeneration:");
  });
});
