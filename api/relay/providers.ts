// api/relay/providers.ts
//
// Pure provider implementations for AI completions. No AWS SDK imports — these
// are plain fetch wrappers so they can be reused by relay-handler.ts (Lambda)
// and future eval tooling without pulling in VPC/SSM dependencies.
//
// Each provider fn receives an already-resolved (apiKey, model, payload) and
// returns the delivered text PLUS the metering facts (#98): the model id the
// provider echoed back and the token counts it reported. Timeout is shared so
// both providers honour the same Lambda-budget ceiling.
//
// USAGE IS NEVER FATAL (#98). A response with no/garbled usage block yields
// `usage: null` and a console.warn — it must NOT throw, because a throw here
// becomes an S3 error marker → `job.status === "error"` → BAD_GATEWAY at the
// door → the user's action fails because pricing could not price it. Credit is
// admitted up-front (`admit`, balance > 0); an unpriceable delivered call is
// charged 0 and made visible, never refused.

import type { Usage } from "../../shared/domain/cost-of-goods";

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

/** What a completion actually delivered: the text, the model that really ran
 *  (echoed by the provider, else the requested id), and the reported tokens
 *  (`null` when the provider sent none — charged 0, never estimated). */
export interface ProviderResult {
  readonly text: string;
  readonly model: string;
  readonly usage: Usage | null;
}

export type ProviderFn = (
  apiKey: string,
  model: string,
  payload: AiPayload,
) => Promise<ProviderResult>;

// ── Pure usage extractors (shared with the streaming Lambda) ──────────────────
//
// Exported and pure so both senders and their tests use the SAME parsing. Both
// return null (never throw) on an absent or malformed block.

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** OpenAI usage block (`{ input_tokens, output_tokens }`) → Usage. Reasoning
 *  tokens are already inside `output_tokens`. */
export function usageFromOpenaiBlock(block: unknown): Usage | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as { input_tokens?: unknown; output_tokens?: unknown };
  const inputTokens = finiteCount(b.input_tokens);
  const outputTokens = finiteCount(b.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

/** Gemini `usageMetadata` → Usage. `thoughtsTokenCount` (thinking tokens) is
 *  billed as OUTPUT by Google, so it is ADDED to `candidatesTokenCount`. */
export function usageFromGeminiMetadata(metadata: unknown): Usage | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const m = metadata as {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
  const inputTokens = finiteCount(m.promptTokenCount);
  const candidates = finiteCount(m.candidatesTokenCount);
  if (inputTokens === null || candidates === null) return null;
  return { inputTokens, outputTokens: candidates + (finiteCount(m.thoughtsTokenCount) ?? 0) };
}

/** The model id a response echoed back, else the requested id (never empty). */
export function echoedModel(echoed: unknown, requested: string): string {
  return typeof echoed === "string" && echoed.length > 0 ? echoed : requested;
}

// ── Gemini ────────────────────────────────────────────────────────────────────

export async function geminiComplete(
  apiKey: string,
  model: string,
  payload: AiPayload,
): Promise<ProviderResult> {
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
    usageMetadata?: unknown;
    modelVersion?: unknown;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (text.length === 0) throw new Error("Empty completion from Gemini");
  const usage = usageFromGeminiMetadata(data.usageMetadata);
  if (usage === null) console.warn("[relay] gemini response carried no usageMetadata", { model });
  return { text, model: echoedModel(data.modelVersion, model), usage };
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
// reasoning-capable; the PRD pins `effort: "low"` ("with LOW rasoning!",
// design/ai-price-table-by-model.md) — explicitly NOT "none": the product wants
// a current full model at low reasoning, not the non-thinking path. Non-5.x
// models reject the reasoning param, so it is only sent for gpt-5* model ids.
// Pinned by api/relay/openai-reasoning.test.ts for BOTH senders.
export async function openaiComplete(
  apiKey: string,
  model: string,
  payload: AiPayload,
): Promise<ProviderResult> {
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
    body["reasoning"] = { effort: "low" };
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
    usage?: unknown;
    model?: unknown;
  };
  const text = extractResponsesText(data);
  if (text.length === 0) throw new Error("Empty completion from OpenAI");
  const usage = usageFromOpenaiBlock(data.usage);
  if (usage === null) console.warn("[relay] openai response carried no usage block", { model });
  return { text, model: echoedModel(data.model, model), usage };
}
