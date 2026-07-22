import { describe, expect, it } from "vitest";
import { extractGeminiDelta, extractOpenaiDelta } from "./stream-providers";

describe("extractOpenaiDelta (/v1/responses SSE events)", () => {
  it("extracts output_text deltas", () => {
    expect(extractOpenaiDelta({ type: "response.output_text.delta", delta: "olá" })).toBe("olá");
  });

  it("ignores other event types and malformed objects", () => {
    expect(extractOpenaiDelta({ type: "response.completed" })).toBeNull();
    expect(extractOpenaiDelta({ type: "response.output_text.delta", delta: 42 })).toBeNull();
    expect(extractOpenaiDelta(null)).toBeNull();
    expect(extractOpenaiDelta("str")).toBeNull();
  });
});

describe("extractGeminiDelta (streamGenerateContent SSE events)", () => {
  it("joins candidate text parts", () => {
    expect(
      extractGeminiDelta({
        candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
      }),
    ).toBe("ab");
  });

  it("returns null for empty/malformed chunks", () => {
    expect(extractGeminiDelta({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(extractGeminiDelta({})).toBeNull();
    expect(extractGeminiDelta(null)).toBeNull();
  });
});
