// api/relay/providers.test.ts
//
// Unit tests for the pure provider dispatch helpers.
// Network calls are NOT tested here (external dependency); only the logic
// that selects provider, maps secret leaf, and resolves defaults is covered.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { hasCostRate } from "../../shared/domain/cost-of-goods";
import {
  echoedModel,
  extractResponsesText,
  usageFromGeminiMetadata,
  usageFromOpenaiBlock,
} from "./providers";

// Re-export the secret-leaf and default-model helpers inline so we can test
// the same logic without spinning up SSM. The actual mapping is in
// relay-handler.ts; we replicate it here as pure functions to keep tests
// isolated from AWS deps.

type Provider = "gemini" | "openai";

function secretLeaf(provider: Provider): string {
  return provider === "openai" ? "openai-api-key" : "ai-api-key";
}

// #98 review round 2, blocker 2 — READ THE DEFAULTS OUT OF THE HANDLERS.
// These constants used to be hand-copied here, and when round 1 moved both
// handlers to `gpt-5.6-luna` this file kept asserting `gpt-4o-mini`: a GREEN
// guard stating a FALSE production fact. Parsing the source means the copy can
// never disagree with the code it claims to describe again.
const HANDLERS = ["../relay/relay-handler.ts", "../stream/stream-handler.ts"] as const;

function defaultFromSource(file: string, name: string): string {
  const src = readFileSync(join(import.meta.dirname, file), "utf-8");
  const found = new RegExp(`const ${name} = "([^"]+)"`).exec(src);
  if (found?.[1] === undefined) throw new Error(`${name} not found in ${file}`);
  return found[1];
}

/** The default a handler applies when SSM supplies nothing. Both handlers must
 *  agree (they are documented as duplicated) — asserted below. */
function handlerDefault(name: string): string {
  const [relay, stream] = HANDLERS.map((f) => defaultFromSource(f, name));
  if (relay !== stream) throw new Error(`${name} diverged: ${String(relay)} vs ${String(stream)}`);
  return relay ?? "";
}

const DEFAULT_GEMINI_MODEL = handlerDefault("DEFAULT_GEMINI_MODEL");
const DEFAULT_OPENAI_MODEL = handlerDefault("DEFAULT_OPENAI_MODEL");

function defaultModel(provider: Provider): string {
  return provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_GEMINI_MODEL;
}

function resolveProvider(eventProvider: Provider | undefined, ssmDefault: string): Provider {
  if (eventProvider !== undefined) return eventProvider;
  if (ssmDefault === "openai") return "openai";
  return "gemini";
}

describe("secretLeaf", () => {
  it("maps gemini → ai-api-key", () => {
    expect(secretLeaf("gemini")).toBe("ai-api-key");
  });
  it("maps openai → openai-api-key", () => {
    expect(secretLeaf("openai")).toBe("openai-api-key");
  });
});

describe("defaultModel", () => {
  it("gemini default is gemini-3.6-flash (2.0-flash shut down 2026-06-01)", () => {
    expect(defaultModel("gemini")).toBe("gemini-3.6-flash");
  });
  // #98 round 1 moved BOTH handlers off gpt-4o-mini; this guard kept asserting
  // the old id and stayed green (review round 2, blocker 2).
  it("openai default is gpt-5.6-luna", () => {
    expect(defaultModel("openai")).toBe("gpt-5.6-luna");
  });
  it("both handlers declare the SAME defaults (they are documented duplicates)", () => {
    // handlerDefault() throws on divergence — assert it resolves for both names.
    expect(handlerDefault("DEFAULT_OPENAI_MODEL")).toBe(DEFAULT_OPENAI_MODEL);
    expect(handlerDefault("DEFAULT_GEMINI_MODEL")).toBe(DEFAULT_GEMINI_MODEL);
  });
  it("every code default has a cost-of-goods rate row (never meters at 0)", () => {
    expect(hasCostRate(DEFAULT_OPENAI_MODEL)).toBe(true);
    expect(hasCostRate(DEFAULT_GEMINI_MODEL)).toBe(true);
  });
});

describe("extractResponsesText (/v1/responses reply parsing)", () => {
  it("prefers the aggregated output_text field", () => {
    expect(extractResponsesText({ output_text: "olá" })).toBe("olá");
  });

  it("joins message items' output_text parts when output_text is absent", () => {
    expect(
      extractResponsesText({
        output: [
          { type: "reasoning" },
          { type: "message", content: [{ type: "output_text", text: '{"answer":' }] },
          { type: "message", content: [{ type: "output_text", text: '"ok"}' }] },
        ],
      }),
    ).toBe('{"answer":"ok"}');
  });

  it("ignores non-text parts and returns empty for no output", () => {
    expect(extractResponsesText({})).toBe("");
    expect(
      extractResponsesText({ output: [{ type: "message", content: [{ type: "refusal" }] }] }),
    ).toBe("");
  });
});

// ── #98 usage extraction — the counts that used to never be collected ────────

describe("usageFromOpenaiBlock (Responses API usage block)", () => {
  it("reads input_tokens / output_tokens (reasoning already inside output)", () => {
    expect(
      usageFromOpenaiBlock({ input_tokens: 1234, output_tokens: 567, total_tokens: 1801 }),
    ).toEqual({ inputTokens: 1234, outputTokens: 567 });
  });

  it("a response with NO usage block → null, never a throw", () => {
    for (const bad of [undefined, null, {}, { input_tokens: 10 }, { input_tokens: "10" }, 42]) {
      expect(usageFromOpenaiBlock(bad)).toBeNull();
    }
    expect(() => usageFromOpenaiBlock(undefined)).not.toThrow();
  });

  it("rejects negative / non-finite counters", () => {
    expect(usageFromOpenaiBlock({ input_tokens: -1, output_tokens: 5 })).toBeNull();
    expect(usageFromOpenaiBlock({ input_tokens: Number.NaN, output_tokens: 5 })).toBeNull();
  });
});

describe("usageFromGeminiMetadata (usageMetadata)", () => {
  it("ADDS thoughtsTokenCount to candidatesTokenCount (thinking bills as output)", () => {
    expect(
      usageFromGeminiMetadata({
        promptTokenCount: 800,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 350,
        totalTokenCount: 1350,
      }),
    ).toEqual({ inputTokens: 800, outputTokens: 550 });
  });

  it("treats an absent thoughtsTokenCount as zero (non-thinking models)", () => {
    expect(usageFromGeminiMetadata({ promptTokenCount: 800, candidatesTokenCount: 200 })).toEqual({
      inputTokens: 800,
      outputTokens: 200,
    });
  });

  it("a response with NO usageMetadata → null, never a throw", () => {
    for (const bad of [undefined, null, {}, { promptTokenCount: 10 }, "x"]) {
      expect(usageFromGeminiMetadata(bad)).toBeNull();
    }
    expect(() => usageFromGeminiMetadata(null)).not.toThrow();
  });
});

describe("echoedModel (the model that really ran)", () => {
  it("prefers the id the provider echoed back", () => {
    expect(echoedModel("gemini-3.6-flash-002", "gemini-3.6-flash")).toBe("gemini-3.6-flash-002");
  });
  it("falls back to the requested id when absent/empty", () => {
    expect(echoedModel(undefined, "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(echoedModel("", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(echoedModel(7, "gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("resolveProvider (event.provider ?? SSM default ?? gemini)", () => {
  it("event provider takes precedence over SSM default", () => {
    expect(resolveProvider("openai", "gemini")).toBe("openai");
    expect(resolveProvider("gemini", "openai")).toBe("gemini");
  });
  it("falls through to SSM default when event provider is absent", () => {
    expect(resolveProvider(undefined, "openai")).toBe("openai");
    expect(resolveProvider(undefined, "gemini")).toBe("gemini");
  });
  it("falls through to gemini when SSM default is unrecognised", () => {
    expect(resolveProvider(undefined, "unknown")).toBe("gemini");
  });
});
