// app/src/shared/lib/ai-eval-service.ts
//
// Thin client for the central mrhewbuc relay (project=lexflow, task=complete).
// AI calls are made from the browser: we POST { promptId, variables } + the
// user's Clerk JWT to the relay's Function URL. The relay validates the JWT
// offline, assembles system+user from server-side prompt templates, and calls
// the LLM provider with its own key. No AI key or prompt text lives in this
// bundle. Reply parsing stays in shared/domain/ai-eval.ts.

import {
  aiCompleteResponseSchema,
  type AiCompletePayload,
  type AiCompleteResponse,
} from "@shared/domain/ai-eval";

// Identifies lexflow in the relay's PROJECTS registry.
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
