// api/stream/stream-providers.ts
//
// Streaming provider clients for the stream Lambda. Same providers as
// api/relay/providers.ts but over SSE, emitting text deltas as they arrive.
// OpenAI uses the Responses API (/v1/responses, stream:true) — NOT chat
// completions. Pure fetch + parsing; no AWS imports (testable).

import {
  AI_TIMEOUT_MS,
  echoedModel,
  usageFromGeminiMetadata,
  usageFromOpenaiBlock,
  type AiPayload,
  type ProviderResult,
} from "../relay/providers";
import type { Usage } from "../../shared/domain/cost-of-goods";

export type OnDelta = (text: string) => void;

// ── Usage / model collectors (#98) ────────────────────────────────────────────
//
// consumeSse used to DISCARD every non-delta event, so a usage frame was thrown
// away even when the provider sent one. These pure extractors pick it back up.
// A stream that ends with no usage frame yields `usage: null` — it does NOT
// throw: the reply was delivered, so it is charged 0 and made visible, never
// refused (empty TEXT stays a real delivery failure, see consumeSse).

/** OpenAI Responses SSE: the terminal `response.completed` event carries usage. */
export function extractOpenaiStreamUsage(obj: unknown): Usage | null {
  if (typeof obj !== "object" || obj === null) return null;
  const e = obj as { type?: unknown; response?: { usage?: unknown } };
  if (e.type !== "response.completed") return null;
  return usageFromOpenaiBlock(e.response?.usage);
}

/** Gemini SSE: every chunk may carry `usageMetadata`; the LAST one wins. */
export function extractGeminiStreamUsage(obj: unknown): Usage | null {
  if (typeof obj !== "object" || obj === null) return null;
  return usageFromGeminiMetadata((obj as { usageMetadata?: unknown }).usageMetadata);
}

/** OpenAI Responses SSE: the model that really ran, off the completed event. */
export function extractOpenaiStreamModel(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const e = obj as { response?: { model?: unknown } };
  const model = e.response?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

/** Gemini SSE: chunks echo `modelVersion`. */
export function extractGeminiStreamModel(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const version = (obj as { modelVersion?: unknown }).modelVersion;
  return typeof version === "string" && version.length > 0 ? version : null;
}

// Extract the text delta from one OpenAI Responses SSE event object.
export function extractOpenaiDelta(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const e = obj as { type?: string; delta?: string };
  return e.type === "response.output_text.delta" && typeof e.delta === "string" ? e.delta : null;
}

// Extract the text delta from one Gemini streamGenerateContent SSE event object.
export function extractGeminiDelta(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const e = obj as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (e.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return text.length > 0 ? text : null;
}

/** The pure extractors one provider's SSE stream is read with. */
interface SseReaders {
  readonly delta: (obj: unknown) => string | null;
  readonly usage: (obj: unknown) => Usage | null;
  readonly model: (obj: unknown) => string | null;
}

// Read an SSE body, invoking the delta reader per `data:` line and onDelta per
// hit, while COLLECTING the last usage/model frame seen (#98 — these used to be
// dropped on the floor). Returns the accumulated text plus the metering facts.
async function consumeSse(
  res: Response,
  readers: SseReaders,
  onDelta: OnDelta,
): Promise<{ text: string; model: string | null; usage: Usage | null }> {
  if (res.body === null) throw new Error("empty stream body");
  // Node's fetch types the stream chunks as any; they are Uint8Array bytes.
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usage: Usage | null = null;
  let model: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]" || data.length === 0) continue;
      try {
        const event: unknown = JSON.parse(data);
        const delta = readers.delta(event);
        if (delta !== null) {
          full += delta;
          onDelta(delta);
        }
        // Last frame wins: Gemini repeats usageMetadata, OpenAI sends one
        // terminal response.completed. A frame that carries neither is a no-op.
        usage = readers.usage(event) ?? usage;
        model = readers.model(event) ?? model;
      } catch {
        // Non-JSON keepalives are expected; skip.
      }
    }
  }
  // Empty TEXT stays a delivery failure (nothing was delivered). Absent USAGE
  // does NOT — it is priced as `unpriced` downstream, never refused.
  if (full.length === 0) throw new Error("empty streamed completion");
  return { text: full, model, usage };
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

export async function streamOpenai(
  apiKey: string,
  model: string,
  payload: AiPayload,
  onDelta: OnDelta,
): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model,
    input: payload.user,
    max_output_tokens: payload.maxOutputTokens ?? 1024,
    stream: true,
  };
  if (payload.system !== undefined && payload.system.length > 0) {
    body["instructions"] = payload.system;
  }
  if (payload.json === true) {
    body["text"] = { format: { type: "json_object" } };
  }
  if (model.startsWith("gpt-5")) {
    // PRD pins LOW reasoning (design/ai-price-table-by-model.md), not "none".
    // Must stay in lockstep with api/relay/providers.ts — both pinned by
    // api/relay/openai-reasoning.test.ts.
    body["reasoning"] = { effort: "low" };
  }

  const t = withTimeout();
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${String(res.status)}: ${detail}`);
    }
    const out = await consumeSse(
      res,
      {
        delta: extractOpenaiDelta,
        usage: extractOpenaiStreamUsage,
        model: extractOpenaiStreamModel,
      },
      onDelta,
    );
    if (out.usage === null) console.warn("[stream] openai stream carried no usage", { model });
    return { text: out.text, model: echoedModel(out.model, model), usage: out.usage };
  } finally {
    t.clear();
  }
}

export async function streamGemini(
  apiKey: string,
  model: string,
  payload: AiPayload,
  onDelta: OnDelta,
): Promise<ProviderResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const generationConfig: Record<string, unknown> = {
    max_output_tokens: payload.maxOutputTokens ?? 1024,
  };
  if (payload.json === true) generationConfig["response_mime_type"] = "application/json";
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: payload.user }] }],
    generation_config: generationConfig,
  };
  if (payload.system !== undefined && payload.system.length > 0) {
    body["system_instruction"] = { parts: [{ text: payload.system }] };
  }

  const t = withTimeout();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini API ${String(res.status)}: ${detail}`);
    }
    const out = await consumeSse(
      res,
      {
        delta: extractGeminiDelta,
        usage: extractGeminiStreamUsage,
        model: extractGeminiStreamModel,
      },
      onDelta,
    );
    if (out.usage === null) console.warn("[stream] gemini stream carried no usage", { model });
    return { text: out.text, model: echoedModel(out.model, model), usage: out.usage };
  } finally {
    t.clear();
  }
}
