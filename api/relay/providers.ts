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

export async function openaiComplete(
  apiKey: string,
  model: string,
  payload: AiPayload,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (payload.system !== undefined && payload.system.length > 0) {
    messages.push({ role: "system", content: payload.system });
  }
  messages.push({ role: "user", content: payload.user });

  const body: Record<string, unknown> = {
    model,
    messages,
    // gpt-5.x models reject `max_tokens` — only `max_completion_tokens` is accepted.
    max_completion_tokens: payload.maxOutputTokens ?? 1024,
  };
  if (payload.json === true) {
    body["response_format"] = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
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
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (text.length === 0) throw new Error("Empty completion from OpenAI");
  return text;
}
