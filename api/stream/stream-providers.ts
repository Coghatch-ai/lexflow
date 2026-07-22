// api/stream/stream-providers.ts
//
// Streaming provider clients for the stream Lambda. Same providers as
// api/relay/providers.ts but over SSE, emitting text deltas as they arrive.
// OpenAI uses the Responses API (/v1/responses, stream:true) — NOT chat
// completions. Pure fetch + parsing; no AWS imports (testable).

import { AI_TIMEOUT_MS, type AiPayload } from "../relay/providers";

export type OnDelta = (text: string) => void;

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

// Read an SSE body, invoking extract() per `data:` line and onDelta per hit.
// Returns the accumulated full text.
async function consumeSse(
  res: Response,
  extract: (obj: unknown) => string | null,
  onDelta: OnDelta,
): Promise<string> {
  if (res.body === null) throw new Error("empty stream body");
  // Node's fetch types the stream chunks as any; they are Uint8Array bytes.
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
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
        const delta = extract(JSON.parse(data));
        if (delta !== null) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // Non-JSON keepalives are expected; skip.
      }
    }
  }
  if (full.length === 0) throw new Error("empty streamed completion");
  return full;
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
): Promise<string> {
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
    body["reasoning"] = { effort: "none" };
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
    return await consumeSse(res, extractOpenaiDelta, onDelta);
  } finally {
    t.clear();
  }
}

export async function streamGemini(
  apiKey: string,
  model: string,
  payload: AiPayload,
  onDelta: OnDelta,
): Promise<string> {
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
    return await consumeSse(res, extractGeminiDelta, onDelta);
  } finally {
    t.clear();
  }
}
