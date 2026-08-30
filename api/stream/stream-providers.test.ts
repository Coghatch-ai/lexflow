import { describe, expect, it } from "vitest";
import {
  extractGeminiDelta,
  extractGeminiStreamModel,
  extractGeminiStreamUsage,
  extractOpenaiDelta,
  extractOpenaiStreamModel,
  extractOpenaiStreamUsage,
} from "./stream-providers";

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

// ── #98 — the streaming surface used to DISCARD every non-delta event, so the
// usage frame was thrown away even when the provider sent one. The tutor with
// stream:true is the sixth AI surface and it must meter like the other five.

describe("extractOpenaiStreamUsage (terminal response.completed event)", () => {
  it("reads usage off the completed event", () => {
    expect(
      extractOpenaiStreamUsage({
        type: "response.completed",
        response: {
          model: "gpt-4o-mini",
          usage: { input_tokens: 640, output_tokens: 218 },
        },
      }),
    ).toEqual({ inputTokens: 640, outputTokens: 218 });
  });

  it("a stream that never sends a completed/usage frame → null, no throw", () => {
    expect(
      extractOpenaiStreamUsage({ type: "response.output_text.delta", delta: "oi" }),
    ).toBeNull();
    expect(extractOpenaiStreamUsage({ type: "response.completed", response: {} })).toBeNull();
    expect(extractOpenaiStreamUsage(null)).toBeNull();
    expect(() => extractOpenaiStreamUsage("x")).not.toThrow();
  });
});

describe("extractGeminiStreamUsage (usageMetadata on the last chunk)", () => {
  it("reads usageMetadata and counts thinking tokens as output", () => {
    expect(
      extractGeminiStreamUsage({
        candidates: [{ content: { parts: [{ text: "fim" }] } }],
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 90,
          thoughtsTokenCount: 40,
        },
      }),
    ).toEqual({ inputTokens: 500, outputTokens: 130 });
  });

  it("a chunk with no usageMetadata → null, no throw", () => {
    expect(extractGeminiStreamUsage({ candidates: [] })).toBeNull();
    expect(extractGeminiStreamUsage(null)).toBeNull();
    expect(() => extractGeminiStreamUsage(undefined)).not.toThrow();
  });
});

describe("stream model extraction (the model that really ran)", () => {
  it("openai: off response.model; gemini: off modelVersion", () => {
    expect(
      extractOpenaiStreamModel({ type: "response.completed", response: { model: "gpt-4o" } }),
    ).toBe("gpt-4o");
    expect(extractGeminiStreamModel({ modelVersion: "gemini-3.6-flash" })).toBe("gemini-3.6-flash");
  });

  it("null when absent (the caller falls back to the requested id)", () => {
    expect(extractOpenaiStreamModel({ type: "response.completed", response: {} })).toBeNull();
    expect(extractGeminiStreamModel({ modelVersion: "" })).toBeNull();
    expect(extractGeminiStreamModel(null)).toBeNull();
  });
});
