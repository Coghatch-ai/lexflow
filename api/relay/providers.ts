// api/relay/providers.ts
//
// Pure provider implementations for AI completions. No AWS SDK imports — these
// are plain fetch wrappers so they can be reused by relay-handler.ts (Lambda)
// and future eval tooling without pulling in VPC/SSM dependencies.
//
// Each provider fn receives an already-resolved (apiKey, model, payload) and
// returns the raw text completion. Timeout is shared so both providers honour
// the same Lambda-budget ceiling.

// Bound the upstream LLM call below the Lambda timeout so a hung provider
// returns a clean error rather than an opaque Lambda timeout.
export const AI_TIMEOUT_MS = 25_000;

// Resolved `ai`-channel payload forwarded from the API (no promptId/vars).
export interface AiPayload {
  system?: string | undefined;
  user: string;
  json?: boolean | undefined;
  maxOutputTokens?: number | undefined;
}

export type ProviderFn = (apiKey: string, model: string, payload: AiPayload) => Promise<string>;

// ── Gemini ────────────────────────────────────────────────────────────────────

export async function geminiComplete(
  apiKey: string,
  model: string,
  payload: AiPayload,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API ${String(res.status)}: ${detail}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (text.length === 0) throw new Error("Empty completion from Gemini");
  return text;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

// Responses API item shape (the subset we read back).
interface ResponsesOutputItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

// Extract the assistant text from a /v1/responses reply: prefer the aggregated
// `output_text` convenience field when present, else join the message items'
// output_text parts.
export function extractResponsesText(data: {
  output_text?: string;
  output?: ResponsesOutputItem[];
}): string {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }
  return (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

// Uses the Responses API (/v1/responses) — NOT chat completions. gpt-5.x are
// reasoning-capable; `effort: "none"` keeps them in the fast non-thinking path
// (latency-sensitive mobile flows). Non-5.x models reject the reasoning param,
// so it is only sent for gpt-5* model ids.
export async function openaiComplete(
  apiKey: string,
  model: string,
  payload: AiPayload,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    input: payload.user,
    max_output_tokens: payload.maxOutputTokens ?? 1024,
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

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI API ${String(res.status)}: ${detail}`);
  }
  const data = (await res.json()) as {
    output_text?: string;
    output?: ResponsesOutputItem[];
  };
  const text = extractResponsesText(data);
  if (text.length === 0) throw new Error("Empty completion from OpenAI");
  return text;
}
