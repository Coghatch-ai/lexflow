import { describe, expect, it } from "vitest";
import { KEEPALIVE_MAX_BYTES, exitBodyBytes, exitTransportFor } from "./exit-save";

/** A draft payload of roughly the size its `answers` array makes it. */
function draftOf(answers: number): Record<string, unknown> {
  return {
    mode: "real",
    questionIds: Array.from({ length: answers }, (_, i) => `question-${String(i)}-uuid-0000-0000`),
    answers: Array.from({ length: answers }, (_, i) => ({
      questionId: `question-${String(i)}-uuid-0000-0000`,
      userAnswer: "A",
      correct: false,
      timeSpent: 0,
    })),
  };
}

describe("exitTransportFor", () => {
  it("uses keepalive for a real prova real draft", () => {
    // ~25 KB of jsonb is the size this slice actually writes — the mechanism
    // must cover the case it exists for, not only a toy payload.
    const draft = draftOf(200);
    expect(exitBodyBytes(draft)).toBeLessThan(KEEPALIVE_MAX_BYTES);
    expect(exitTransportFor(draft)).toBe("keepalive");
  });

  it("falls back to the normal client once the body outgrows the browser's cap", () => {
    // Over the cap the browser REJECTS the request outright, so sending it
    // anyway would trade a partial guarantee for none at all.
    const huge = { note: "x".repeat(KEEPALIVE_MAX_BYTES + 1) };
    expect(exitTransportFor(huge)).toBe("normal");
  });

  it("keeps the budget under the 64 KiB the Fetch standard allows", () => {
    // Headroom for the tRPC batch envelope, superjson's `meta`, and any other
    // keepalive request the page has out — all of which count against the cap.
    expect(KEEPALIVE_MAX_BYTES).toBeLessThan(65_536);
  });

  it("measures BYTES, not characters", () => {
    // The cap is on bytes and pt-BR copy is not ASCII: counting `.length` would
    // under-measure an accented payload and send it over the cap.
    expect(exitBodyBytes({ a: "ção" })).toBeGreaterThan(JSON.stringify({ a: "ção" }).length);
  });

  it("decides on the edge, not near it", () => {
    const atCap = "x".repeat(KEEPALIVE_MAX_BYTES - JSON.stringify({ note: "" }).length);
    expect(exitBodyBytes({ note: atCap })).toBe(KEEPALIVE_MAX_BYTES);
    expect(exitTransportFor({ note: atCap })).toBe("keepalive");
    expect(exitTransportFor({ note: `${atCap}x` })).toBe("normal");
  });
});
