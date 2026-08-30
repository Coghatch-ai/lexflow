// api/lib/ai-metering.parse.test.ts
//
// #98 — parseAiResult, the ONE place a relay/stream result becomes billable
// facts. This is the direct guard on the bug: before the fix the doors metered a
// HARDCODED token count against a GLOBAL default model, so the charge was pure
// fiction and switching provider changed nothing.
//
// The contract these tests pin has TWO distinct failure notions — conflating
// them is what the amended analysis had to correct:
//   - REFUSAL TO PRICE  → kind:"unpriced". The text is delivered, the action
//     completes, the call is charged 0 and made visible. NEVER throws.
//   - DELIVERY FAILURE  → BAD_GATEWAY. The ONLY such condition is missing text.
// Credit is admitted at the door (balance > 0) before the call; metering runs on
// the way back and may never veto what was already delivered.

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { parseAiResult } from "./ai-metering";
import { costFor } from "../../shared/domain/cost-of-goods";

const TEXT = '{"answer":"ok"}';
const good = { text: TEXT, model: "gpt-4o-mini", usage: { inputTokens: 900, outputTokens: 120 } };

// Every payload that must be REFUSED FOR PRICING but still delivered.
const unpricedFixtures: ReadonlyArray<{ name: string; payload: unknown; reason: string }> = [
  { name: "usage absent", payload: { text: TEXT, model: "gpt-4o-mini" }, reason: "usage-missing" },
  {
    name: "usage null",
    payload: { text: TEXT, model: "gpt-4o-mini", usage: null },
    reason: "usage-missing",
  },
  {
    name: "negative counter",
    payload: { text: TEXT, model: "gpt-4o-mini", usage: { inputTokens: -5, outputTokens: 10 } },
    reason: "usage-invalid",
  },
  {
    name: "NaN counter",
    payload: {
      text: TEXT,
      model: "gpt-4o-mini",
      usage: { inputTokens: Number.NaN, outputTokens: 10 },
    },
    reason: "usage-invalid",
  },
  {
    name: "both counters zero",
    payload: { text: TEXT, model: "gpt-4o-mini", usage: { inputTokens: 0, outputTokens: 0 } },
    reason: "usage-invalid",
  },
  {
    name: "counter is a string",
    payload: { text: TEXT, model: "gpt-4o-mini", usage: { inputTokens: "900", outputTokens: 10 } },
    reason: "usage-invalid",
  },
  {
    name: "model absent",
    payload: { text: TEXT, usage: { inputTokens: 900, outputTokens: 120 } },
    reason: "model-missing",
  },
  {
    name: "model empty",
    payload: { text: TEXT, model: "", usage: { inputTokens: 900, outputTokens: 120 } },
    reason: "model-missing",
  },
  {
    name: "model has no rate row",
    payload: {
      text: TEXT,
      model: "gemini-2.0-flash", // shut down 2026-06-01, deliberately rate-less
      usage: { inputTokens: 900, outputTokens: 120 },
    },
    reason: "no-rate-row",
  },
  {
    // Review round 1: a snapshot that still resolves to NOTHING must keep the
    // visible :unmetered / 0¢ / log behaviour — the suffix rule must never
    // become a guess. `gpt-5.6-sol` is real, expensive and un-priced.
    name: "echoed snapshot of an UN-PRICED model",
    payload: {
      text: TEXT,
      model: "gpt-5.6-sol-2026-08-01",
      usage: { inputTokens: 900, outputTokens: 120 },
    },
    reason: "no-rate-row",
  },
  {
    name: "a DIFFERENT variant that merely shares a prefix with a priced row",
    payload: {
      text: TEXT,
      model: "gpt-4o-realtime", // must NOT inherit the gpt-4o rate
      usage: { inputTokens: 900, outputTokens: 120 },
    },
    reason: "no-rate-row",
  },
];

// What the providers ACTUALLY echo back — the ids pricing sees in production.
// Before the round-1 fix every one of these landed `no-rate-row` ⇒ 0¢, so the
// whole suite was green in exactly the scenario where prod billed nothing.
const echoedPricedIds: readonly string[] = [
  "gpt-4o-mini-2024-07-18", // OpenAI Responses API: dated snapshot
  "gpt-5.6-luna-2026-08-01", // the new code default, snapshot form
  "gemini-3.6-flash-002", // Gemini modelVersion: 3-digit revision
  "gemini-3.1-flash-lite-001",
];

describe("#98 parseAiResult — a complete payload prices on REAL facts", () => {
  it("payload completo → kind:'priced' com model e usage exatos", () => {
    const parsed = parseAiResult(good);
    expect(parsed.kind).toBe("priced");
    expect(parsed.text).toBe(TEXT);
    if (parsed.kind !== "priced") throw new Error("expected priced");
    expect(parsed.model).toBe("gpt-4o-mini");
    expect(parsed.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
  });

  it("takes the model the SENDER reported — never a default, never the tRPC input", () => {
    const parsed = parseAiResult({ ...good, model: "gemini-3.6-flash" });
    if (parsed.kind !== "priced") throw new Error("expected priced");
    expect(parsed.model).toBe("gemini-3.6-flash");
  });

  it("model ecoado versionado (gpt-4o-mini-2024-07-18 / gemini-3.6-flash-002) → kind:'priced'", () => {
    for (const echoed of echoedPricedIds) {
      const parsed = parseAiResult({ ...good, model: echoed });
      expect(parsed.kind).toBe("priced");
      if (parsed.kind !== "priced") throw new Error(`expected priced for ${echoed}`);
      // The ECHOED id is kept verbatim for audit; only PRICING resolves it.
      expect(parsed.model).toBe(echoed);
      expect(costFor(parsed.model, parsed.usage)).toBeGreaterThan(0);
    }
  });

  it("the echoed snapshot costs the SAME as its alias (no silent discount)", () => {
    const usage = { inputTokens: 900, outputTokens: 120 };
    expect(costFor("gpt-4o-mini-2024-07-18", usage)).toBeCloseTo(costFor("gpt-4o-mini", usage), 8);
    expect(costFor("gemini-3.6-flash-002", usage)).toBeCloseTo(
      costFor("gemini-3.6-flash", usage),
      8,
    );
  });

  it("a zero on ONE side is still priceable (prompt-only / output-only calls)", () => {
    const parsed = parseAiResult({ ...good, usage: { inputTokens: 900, outputTokens: 0 } });
    expect(parsed.kind).toBe("priced");
  });
});

describe("#98 parseAiResult — REFUSAL TO PRICE is not a failure of the user's action", () => {
  for (const fixture of unpricedFixtures) {
    it(`${fixture.name} → RECUSA de parse: kind:'unpriced', reason '${fixture.reason}' — NÃO lança`, () => {
      const parsed = parseAiResult(fixture.payload);
      expect(parsed.kind).toBe("unpriced");
      if (parsed.kind !== "unpriced") throw new Error("expected unpriced");
      expect(parsed.reason).toBe(fixture.reason);
    });
  }

  it("recusa de parse PRESERVA o texto entregue (a ação do usuário não falha)", () => {
    for (const fixture of unpricedFixtures) {
      expect(parseAiResult(fixture.payload).text).toBe(TEXT);
    }
  });

  it("nenhum ramo unpriced lança TRPCError", () => {
    for (const fixture of unpricedFixtures) {
      expect(() => parseAiResult(fixture.payload)).not.toThrow();
    }
  });

  it("NEVER estimates: an unpriced result carries no usage field to fall back on", () => {
    const parsed = parseAiResult({ text: TEXT, model: "gpt-4o-mini" });
    expect(parsed).not.toHaveProperty("usage");
  });
});

describe("#98 parseAiResult — the ONLY delivery failure is missing text", () => {
  it("text ausente → BAD_GATEWAY: única condição que é falha de entrega", () => {
    for (const payload of [
      { model: "gpt-4o-mini", usage: { inputTokens: 9, outputTokens: 9 } },
      { text: "", model: "gpt-4o-mini", usage: { inputTokens: 9, outputTokens: 9 } },
      { text: 42, model: "gpt-4o-mini" },
      null,
      undefined,
      "not an object",
    ]) {
      let thrown: unknown;
      try {
        parseAiResult(payload);
      } catch (err: unknown) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(TRPCError);
      expect((thrown as TRPCError).code).toBe("BAD_GATEWAY");
    }
  });
});
