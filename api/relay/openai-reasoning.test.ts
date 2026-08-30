// api/relay/openai-reasoning.test.ts
//
// #98 pre-PR round — the PRD's verbatim requirement is `effort: "low"`
// ("with LOW rasoning!", design/ai-price-table-by-model.md), explicitly NOT
// "none". Both OpenAI senders shipped "none" and NOTHING pinned the value, so a
// silent revert stayed green. This file is the thing that goes red on that
// revert: it inspects the JSON body each sender actually PUTS ON THE WIRE.
//
// Both senders are covered here (they are documented duplicates, like the
// DEFAULT_*_MODEL constants in providers.test.ts) so the pin can never hold on
// one surface while the other drifts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiComplete } from "./providers";
import { streamOpenai } from "../stream/stream-providers";

/** Bodies captured from the stubbed fetch, in call order. */
const bodies: Array<Record<string, unknown>> = [];

function stubFetch(makeResponse: () => Response): void {
  vi.stubGlobal("fetch", (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    return Promise.resolve(makeResponse());
  });
}

/** `body.reasoning.effort` as sent, or undefined when the param was omitted. */
function effortOf(body: Record<string, unknown> | undefined): unknown {
  const reasoning = body?.["reasoning"];
  if (typeof reasoning !== "object" || reasoning === null) return undefined;
  return (reasoning as { effort?: unknown }).effort;
}

function jsonResponse(): Response {
  return new Response(
    JSON.stringify({
      output_text: "ok",
      model: "gpt-5.6-luna",
      usage: { input_tokens: 10, output_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sseResponse(): Response {
  const frames = [
    'data: {"type":"response.output_text.delta","delta":"ok"}',
    'data: {"type":"response.completed","response":{"model":"gpt-5.6-luna","usage":{"input_tokens":10,"output_tokens":4}}}',
    "data: [DONE]",
  ].join("\n\n");
  return new Response(`${frames}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  bodies.length = 0;
});

describe("openai reasoning effort — the PRD pins LOW, not none (#98)", () => {
  it('relay sender (openaiComplete) sends effort:"low" for gpt-5*', async () => {
    stubFetch(jsonResponse);
    await openaiComplete("k", "gpt-5.6-luna", { user: "oi" });
    expect(effortOf(bodies[0])).toBe("low");
  });

  it('stream sender (streamOpenai) sends effort:"low" for gpt-5*', async () => {
    stubFetch(sseResponse);
    await streamOpenai("k", "gpt-5.6-luna", { user: "oi" }, () => {
      /* deltas are irrelevant here */
    });
    expect(effortOf(bodies[0])).toBe("low");
  });

  it('BOTH senders agree — neither may drift to "none" alone', async () => {
    stubFetch(jsonResponse);
    await openaiComplete("k", "gpt-5.6-luna", { user: "oi" });
    vi.unstubAllGlobals();
    stubFetch(sseResponse);
    await streamOpenai("k", "gpt-5.6-luna", { user: "oi" }, () => {
      /* no-op */
    });
    expect(bodies.map(effortOf)).toEqual(["low", "low"]);
  });

  it("non-gpt-5 models still omit the reasoning param (they reject it)", async () => {
    stubFetch(jsonResponse);
    await openaiComplete("k", "gpt-4o-mini", { user: "oi" });
    vi.unstubAllGlobals();
    stubFetch(sseResponse);
    await streamOpenai("k", "gpt-4o-mini", { user: "oi" }, () => {
      /* no-op */
    });
    expect(bodies.map((b) => b["reasoning"])).toEqual([undefined, undefined]);
  });
});
