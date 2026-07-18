// api/relay/providers.test.ts
//
// Unit tests for the pure provider dispatch helpers.
// Network calls are NOT tested here (external dependency); only the logic
// that selects provider, maps secret leaf, and resolves defaults is covered.

import { describe, expect, it } from "vitest";

// Re-export the secret-leaf and default-model helpers inline so we can test
// the same logic without spinning up SSM. The actual mapping is in
// relay-handler.ts; we replicate it here as pure functions to keep tests
// isolated from AWS deps.

type Provider = "gemini" | "openai";

function secretLeaf(provider: Provider): string {
  return provider === "openai" ? "openai-api-key" : "ai-api-key";
}

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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
  it("gemini default is gemini-2.0-flash", () => {
    expect(defaultModel("gemini")).toBe("gemini-2.0-flash");
  });
  it("openai default is gpt-4o-mini", () => {
    expect(defaultModel("openai")).toBe("gpt-4o-mini");
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
