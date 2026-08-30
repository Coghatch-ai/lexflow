// api/lib/ai-metering.consume.test.ts
//
// consumeAndCharge — the single-use, atomic consume+charge unit (Codex #61 round 3).
// The two HIGH billing-integrity findings it closes:
//   [1] REPLAY ACROSS TARGETS: a done jobId could be replayed with a different
//       answer/question to persist AI output onto MANY records while charge()'s
//       refId-idempotency blocked the extra charges. Fixed by a durable single-use
//       marker (ai_job_consumption) keyed by refId + BOUND to one target.
//   [2] SPLIT PERSIST/SETTLE: persist then best-effort setTimeout settle could leave
//       output persisted with no charge. Fixed by charging INSIDE the caller tx.
//
// These drive consumeAndCharge directly with a fake tx (its tx.execute scripted per
// call) + charge() spied, so the marker/charge branching is asserted without a DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

// charge() is the money core — spy it so no real ledger write happens and we can
// assert exactly-once (or never) per branch.
const chargeMock = vi.fn(async (_params: unknown) => ({
  outcome: "flushed",
  flushCents: 1,
  owedCents: 1,
}));
vi.mock("./credit-charge", () => ({
  charge: (params: unknown) => chargeMock(params),
  CHARGE_LEDGER_REF_PREFIX: "charge:",
}));

import { consumeAndCharge, type AiMetering } from "./ai-metering";

const USER = "33333333-3333-4333-8333-333333333333";
const JOB = "22222222-2222-4222-8222-222222222222";
const REF = `grade:${JOB}`;

// A fake tx whose execute() returns scripted rows in call order:
//   call 1 = the INSERT … ON CONFLICT DO NOTHING RETURNING (the marker claim)
//   call 2 = the SELECT target_id (only reached on an empty claim = existing marker)
function fakeTx(scripted: Array<{ rows: unknown[] }>): { execute: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    execute: vi.fn(async () => scripted[i++] ?? { rows: [] }),
  };
}

const PRICED = {
  kind: "priced" as const,
  model: "gpt-4o-mini",
  usage: { inputTokens: 1_000_000, outputTokens: 0 },
};

const params = (
  targetId: string,
  tx: { execute: ReturnType<typeof vi.fn> },
  metering: AiMetering = PRICED,
) => ({
  tx: tx as never,
  userId: USER,
  jobId: JOB,
  targetId,
  source: "grade",
  refId: REF,
  metering,
});

beforeEach(() => {
  chargeMock.mockClear();
});

describe("consumeAndCharge — single-use job binding + atomic charge", () => {
  it("(d) FIRST consume: claims the marker AND charges once → 'first'", async () => {
    // Claim RETURNING a row = first consume.
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]);
    const outcome = await consumeAndCharge(params("q1", tx));
    expect(outcome).toBe("first");
    expect(chargeMock).toHaveBeenCalledTimes(1);
    // charge joins the caller tx (atomic) and is delivered.
    const arg = chargeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg?.["refId"]).toBe(REF);
    expect(arg?.["delivered"]).toBe(true);
    expect(arg?.["tx"]).toBe(tx);
  });

  it("(b) REPLAY onto the SAME target → idempotent 'replay', charge NOT called again", async () => {
    // Empty claim (marker exists) → SELECT returns the SAME bound target.
    const tx = fakeTx([{ rows: [] }, { rows: [{ target_id: "q1" }] }]);
    const outcome = await consumeAndCharge(params("q1", tx));
    expect(outcome).toBe("replay");
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it("(a) REPLAY onto a DIFFERENT target → REJECTED (CONFLICT), charge NOT called", async () => {
    // Empty claim → SELECT returns a DIFFERENT bound target → reject.
    const tx = fakeTx([{ rows: [] }, { rows: [{ target_id: "q1" }] }]);
    await expect(consumeAndCharge(params("q-OTHER", tx))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it("(c) ATOMICITY: charge() failure PROPAGATES (no swallow) so the caller tx rolls back", async () => {
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]); // first consume → charge runs
    chargeMock.mockRejectedValueOnce(new Error("charge failed"));
    await expect(consumeAndCharge(params("q1", tx))).rejects.toThrow(/charge failed/);
    // The throw unwinds the caller's transaction → the marker + persist are rolled
    // back with it. Nothing is persisted-but-unsettled (the split-settle hole).
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });
});

describe("#98 PRICED — the charge is REAL tokens × the model that really ran", () => {
  it("rawCents = costFor(model, usage), not a constant", async () => {
    // 1M input tokens of gpt-4o-mini = its input rate (15¢), exactly.
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]);
    await consumeAndCharge(params("q1", tx));
    const arg = chargeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg?.["rawCents"]).toBeCloseTo(15, 6);
    expect(arg?.["source"]).toBe("grade"); // priced → source is NOT suffixed
  });

  it("a different model prices differently (the model is no longer a fixed default)", async () => {
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]);
    await consumeAndCharge(
      params("q1", tx, {
        kind: "priced",
        model: "gemini-3.6-flash",
        usage: { inputTokens: 0, outputTokens: 1_000_000 },
      }),
    );
    const arg = chargeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg?.["rawCents"]).toBeCloseTo(375, 6);
  });
});

describe("#98 UNPRICED — charged 0 and VISIBLE, never a refusal", () => {
  const unpriced: AiMetering = { kind: "unpriced", model: null, reason: "usage-missing" };

  it("charges 0 under a ':unmetered' source and does NOT throw", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]);
    const outcome = await consumeAndCharge(params("q1", tx, unpriced));
    expect(outcome).toBe("first"); // the user's action completes
    const arg = chargeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg?.["rawCents"]).toBe(0);
    expect(arg?.["source"]).toBe("grade:unmetered");
    // refId keeps its identity — the suffix NEVER leaks into idempotency.
    expect(arg?.["refId"]).toBe(REF);
    errSpy.mockRestore();
  });

  it("logs the stable [credits] tag with the reason — exactly once", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tx = fakeTx([{ rows: [{ ref_id: REF }] }]);
    await consumeAndCharge(params("q1", tx, unpriced));
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toBe("[credits] ai usage indisponível — cobrado 0");
    expect(errSpy.mock.calls[0]?.[1]).toMatchObject({ reason: "usage-missing", refId: REF });
    errSpy.mockRestore();
  });

  it("a REPLAY of the same refId produces NO second charge and NO second log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Empty claim = marker already exists → replay onto the same target.
    const tx = fakeTx([{ rows: [] }, { rows: [{ target_id: "q1" }] }]);
    const outcome = await consumeAndCharge(params("q1", tx, unpriced));
    expect(outcome).toBe("replay");
    expect(chargeMock).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
