// api/lib/ai-prompts.ts
//
// Server-owned AI prompt templates, moved out of the retired mrhewbuc-issues
// central relay (`aiPrompts` in its config.ts). The API resolves a prompt into a
// flat { system, user } payload and hands it to the relay's `ai` channel — the
// relay is a dumb sender and never sees the template or the variables. Variable
// building + response parsing live in shared/domain/ai-eval.ts (shared with the
// client). The client now sends domain inputs to tRPC; it no longer picks a
// promptId or assembles prompts.

interface PromptTemplate {
  system: string;
  user: string;
  vars: readonly string[];
  maxOutputTokens: number;
}

export const AI_PROMPTS = {
  // 2ª-fase discursive grading → { score, feedback }.
  "oab-grade": {
    system: `Você é examinador da 2ª fase do Exame de Ordem (OAB). Avalie a resposta do candidato comparando-a ao padrão de resposta oficial e à base legal informados. Atribua uma nota de 0 até o valor máximo da questão e escreva um feedback objetivo em português (pt-BR), apontando os acertos e o que faltou para a pontuação total. Responda SOMENTE com um objeto JSON no formato {"score": number, "feedback": string} — sem cercas de código e sem comentários.`,
    user: "Pontuação máxima: {{maxPoints}}\nEnunciado:\n{{statement}}\nPadrão de resposta:\n{{modelAnswer}}\nBase legal:\n{{legalBasis}}\nResposta do candidato:\n{{studentAnswer}}\nDê a nota de 0 a {{maxPoints}} e o feedback.",
    vars: ["statement", "studentAnswer", "modelAnswer", "legalBasis", "maxPoints"],
    maxOutputTokens: 2048,
  },
  // 1ª-fase objective explanation → { whyCorrect, whyWrong, memoryTip, commonTraps }.
  "oab-explain": {
    system: `Você é um professor especialista no Exame de Ordem da OAB. Para a questão objetiva fornecida, explique em português (pt-BR): 1) Por que a alternativa correta está certa (whyCorrect); 2) Por que cada alternativa incorreta está errada — use a letra/código da alternativa como chave (whyWrong); 3) Uma dica de memorização do conteúdo envolvido (memoryTip); 4) Pegadinhas comuns que fazem candidatos errarem questões assim (commonTraps). Responda SOMENTE com um objeto JSON no formato {"whyCorrect":"...","whyWrong":{"A":"...","B":"..."},"memoryTip":"...","commonTraps":"..."} — sem cercas de código e sem comentários.`,
    user: "Questão:\n{{questionText}}\nAlternativas:\n{{options}}\nAlternativa correta: {{correctAnswer}}\nBase legal: {{legalBasis}}\nGere a explicação nos 4 pilares em JSON.",
    vars: ["questionText", "options", "correctAnswer", "legalBasis"],
    maxOutputTokens: 2048,
  },
} as const satisfies Record<string, PromptTemplate>;

export type PromptId = keyof typeof AI_PROMPTS;

// Resolved relay `ai`-channel payload (matches the relay handler's AiEvent).
export interface AiRelayPayload {
  channel: "ai";
  system: string;
  user: string;
  json: true;
  maxOutputTokens: number;
}

// Single-pass {{var}} fill: only declared names are substituted and inserted
// values are never re-scanned, so a value containing {{x}} can't expand into
// another slot.
function interpolate(
  template: string,
  declared: readonly string[],
  values: Record<string, string>,
): string {
  const allow = new Set(declared);
  return template.replace(/\{\{(\w+)\}\}/g, (m: string, name: string) =>
    allow.has(name) ? (values[name] ?? "") : m,
  );
}

// Resolve a server-owned prompt + caller variables into the relay `ai` payload.
export function resolveAiPrompt(
  promptId: PromptId,
  variables: Record<string, string>,
): AiRelayPayload {
  const p = AI_PROMPTS[promptId];
  return {
    channel: "ai",
    system: p.system,
    user: interpolate(p.user, p.vars, variables),
    json: true,
    maxOutputTokens: p.maxOutputTokens,
  };
}
