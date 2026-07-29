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

import { consumeAndCharge } from "./ai-metering";

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

const params = (targetId: string, tx: { execute: ReturnType<typeof vi.fn> }) => ({
  tx: tx as never,
  userId: USER,
  jobId: JOB,
  targetId,
  source: "grade",
  refId: REF,
  model: "gpt-4o-mini",
  usage: { kind: "tokens" as const, amount: 2048 },
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
