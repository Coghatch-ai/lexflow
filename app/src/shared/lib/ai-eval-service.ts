// app/src/shared/lib/ai-eval-service.ts
//
// Thin client for the central mrhewbuc-issues relay (task=complete). Mirrors
// issue-service.ts: the lexflow Lambda has no internet egress (no NAT), so AI
// calls are made from the browser — we POST the prompt + the user's Clerk JWT to
// the service's Function URL. The relay validates the JWT offline and calls the
// LLM provider with its own key (provider is the service's concern). No secret
// lives in this bundle. The grading prompt + reply parsing live in shared/domain.

import {
  aiCompleteResponseSchema,
  type AiCompletePayload,
  type AiCompleteResponse,
} from "@shared/domain/ai-eval";

// Identifies lexflow in the service's PROJECTS registry.
const PROJECT = "lexflow";

const serviceUrl = import.meta.env.VITE_AI_SERVICE_URL ?? "";

/** Whether the AI relay is wired up — gates the "Avaliar com IA" button. */
export function isAiEvalConfigured(): boolean {
  return serviceUrl.length > 0;
}

export async function aiComplete(
  payload: AiCompletePayload,
  token: string | null,
): Promise<AiCompleteResponse> {
  if (serviceUrl.length === 0) {
    throw new Error("VITE_AI_SERVICE_URL não configurado");
  }
  if (token === null || token.length === 0) {
    throw new Error("Sessão expirada — faça login novamente");
  }

  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project: PROJECT, task: "complete", payload }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.length > 0 ? text : `Falha ao avaliar com IA (${String(res.status)})`);
  }

  return aiCompleteResponseSchema.parse(await res.json());
}
