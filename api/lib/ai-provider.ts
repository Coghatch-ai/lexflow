// api/lib/ai-provider.ts
//
// Direct LLM call from the backend, configured by env (api/.env locally).
// LOCAL-DEV ONLY: the deployed Lambda has no NAT, so this outbound call won't
// work in production — production AI grading goes through the central relay
// instead. Provider-agnostic: Gemini, or any OpenAI-compatible endpoint (OpenAI,
// Groq via AI_BASE_URL). The caller owns the prompt; this returns raw text.

export type CompleteArgs = { system: string; user: string; json: boolean };

/** Whether an AI key is configured — gates the "Avaliar com IA" button. */
export function aiConfigured(): boolean {
  const key = process.env["AI_API_KEY"];
  return key !== undefined && key.length > 0;
}

function requireKey(): string {
  const key = process.env["AI_API_KEY"];
  if (key === undefined || key.length === 0) {
    throw new Error("AI_API_KEY não configurado (api/.env)");
  }
  return key;
}

async function geminiComplete(model: string, args: CompleteArgs): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig: Record<string, unknown> = { max_output_tokens: 1024 };
  if (args.json) generationConfig["response_mime_type"] = "application/json";
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": requireKey(), "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      system_instruction: { parts: [{ text: args.system }] },
      generation_config: generationConfig,
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API ${String(res.status)}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

async function openaiComplete(model: string, args: CompleteArgs): Promise<string> {
  const base = process.env["AI_BASE_URL"] ?? "https://api.openai.com/v1";
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  };
  if (args.json) body["response_format"] = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${requireKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`AI API ${String(res.status)}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function completeAi(args: CompleteArgs): Promise<string> {
  const provider = process.env["AI_PROVIDER"] ?? "gemini";
  const defaultModel = provider === "openai" ? "gpt-4o-mini" : "gemini-2.0-flash";
  const model = process.env["AI_MODEL"] ?? defaultModel;
  const text =
    provider === "openai" ? await openaiComplete(model, args) : await geminiComplete(model, args);
  if (text.length === 0) throw new Error("Resposta vazia do modelo");
  return text;
}
