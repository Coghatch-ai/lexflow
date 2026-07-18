// shared/lib/run-explanation-flow.test.ts
import { describe, it, expect, vi } from "vitest";
import { runExplanationFlow, type ExplanationFlowDeps } from "./run-explanation-flow";
import type { AiExplanation } from "../domain/ai-eval";

const FAKE_EXPLANATION: AiExplanation = {
  whyCorrect: "correta",
  whyWrong: { B: "errada" },
  memoryTip: "dica",
  commonTraps: "pegadinha",
};

function makeDeps(overrides: Partial<ExplanationFlowDeps> = {}): ExplanationFlowDeps {
  return {
    getOrGenerate: vi.fn().mockResolvedValue({
      cached: false,
      explanation: null,
      jobId: "00000000-0000-0000-0000-000000000001",
    }),
    fetchRelayJob: vi.fn().mockResolvedValue({ status: "done", data: {} }),
    finalize: vi.fn().mockResolvedValue({ explanation: FAKE_EXPLANATION }),
    ...overrides,
  };
}

describe("runExplanationFlow", () => {
  it("cache hit: returns immediately, no poll/finalize", async () => {
    const deps = makeDeps({
      getOrGenerate: vi.fn().mockResolvedValue({
        cached: true,
        explanation: FAKE_EXPLANATION,
        jobId: null,
      }),
    });
    const result = await runExplanationFlow("q1", deps);
    expect(result).toEqual(FAKE_EXPLANATION);
    expect(deps.fetchRelayJob).not.toHaveBeenCalled();
    expect(deps.finalize).not.toHaveBeenCalled();
  });

  it("cache miss: polls then finalizes, returns explanation", async () => {
    const deps = makeDeps();
    const result = await runExplanationFlow("q1", deps);
    expect(result).toEqual(FAKE_EXPLANATION);
    expect(deps.fetchRelayJob).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    expect(deps.finalize).toHaveBeenCalledWith({
      id: "q1",
      jobId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("throws when jobId is null on cache miss", async () => {
    const deps = makeDeps({
      getOrGenerate: vi.fn().mockResolvedValue({ cached: false, explanation: null, jobId: null }),
    });
    await expect(runExplanationFlow("q1", deps)).rejects.toThrow("sem jobId");
  });

  it("throws when relay errors during poll", async () => {
    const deps = makeDeps({
      fetchRelayJob: vi.fn().mockResolvedValue({ status: "error", error: "relay explodiu" }),
    });
    await expect(runExplanationFlow("q1", deps)).rejects.toThrow("relay explodiu");
  });
});
