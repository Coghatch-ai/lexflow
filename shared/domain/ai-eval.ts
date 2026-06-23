// shared/domain/ai-eval.ts
//
// AI evaluation for OAB questions: grading for discursive answers (2ª fase) and
// explanation generation for objective questions (1ª fase). The actual model call
// goes through the central mrhewbuc-issues relay (task=complete) — a thin LLM
// proxy that returns raw text. ALL the domain logic lives here in the calling app:
// the prompts, how the question data is laid out, and how the reply is parsed. The
// relay never sees OAB specifics — see [[project-2fase-discursive]].

import { z } from "zod";
import { clampScore } from "./discursive-attempt";

// Config key for the editable grading prompt (app_config table). A missing row
// falls back to DEFAULT_GRADE_SYSTEM_PROMPT below.
export const GRADE_PROMPT_KEY = "grade-discursive-prompt";

// Default grading instructions (system prompt). Editable at runtime via the
// app_config row so it can be tuned during the POC without a deploy; this is the
// seed/fallback and the version-controlled record of "good enough".
export const DEFAULT_GRADE_SYSTEM_PROMPT = [
  "Você é examinador da 2ª fase do Exame de Ordem (OAB).",
  "Avalie a resposta do candidato comparando-a ao padrão de resposta oficial e à base legal informados.",
  "Atribua uma nota de 0 até o valor máximo da questão e escreva um feedback objetivo em português (pt-BR),",
  "apontando os acertos e o que faltou para a pontuação total.",
  'Responda SOMENTE com um objeto JSON no formato {"score": number, "feedback": string} —',
  "sem cercas de código e sem comentários.",
].join(" ");

export type GradeInput = {
  statement: string;
  studentAnswer: string;
  modelAnswer: string | null;
  legalBasis: string | null;
  maxPoints: number;
};

// Build the user message (the data half of the prompt) from one answer. The
// instructions half is the system prompt (DEFAULT_GRADE_SYSTEM_PROMPT or the
// app_config override).
export function buildGradeUserMessage(input: GradeInput): string {
  const parts = [
    `Pontuação máxima: ${String(input.maxPoints)}`,
    `\nEnunciado:\n${input.statement}`,
    input.modelAnswer !== null && input.modelAnswer.length > 0
      ? `\nPadrão de resposta:\n${input.modelAnswer}`
      : "\nPadrão de resposta: (não disponível — avalie pela técnica jurídica)",
    input.legalBasis !== null && input.legalBasis.length > 0
      ? `\nBase legal:\n${input.legalBasis}`
      : "",
    `\nResposta do candidato:\n${input.studentAnswer}`,
    `\nDê a nota de 0 a ${String(input.maxPoints)} e o feedback.`,
  ];
  return parts.join("");
}

// Parse the relay's raw text into a clamped {score, feedback}. Tolerant of stray
// prose or code fences around the JSON. Returns null if no usable JSON is found.
export function parseGradeResponse(
  text: string,
  maxPoints: number,
): { score: number; feedback: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const rawScore =
      typeof parsed["score"] === "number" ? parsed["score"] : Number(parsed["score"]);
    if (!Number.isFinite(rawScore)) return null;
    const feedback = typeof parsed["feedback"] === "string" ? parsed["feedback"] : "";
    return { score: clampScore(rawScore, maxPoints), feedback };
  } catch {
    return null;
  }
}

// ── 1ª-fase objective explanation ─────────────────────────────────────────────

// Config key for the editable explanation prompt (app_config table). Missing row
// falls back to DEFAULT_EXPLAIN_SYSTEM_PROMPT below.
export const EXPLAIN_PROMPT_KEY = "explain-objective-prompt";

// Default explanation instructions (system prompt). Editable at runtime via the
// app_config row so it can be tuned during the POC without a deploy.
export const DEFAULT_EXPLAIN_SYSTEM_PROMPT = [
  "Você é um professor especialista no Exame de Ordem da OAB.",
  "Para a questão objetiva fornecida, explique em português (pt-BR):",
  "1) Por que a alternativa correta está certa (whyCorrect);",
  "2) Por que cada alternativa incorreta está errada — use a letra/código da alternativa como chave (whyWrong);",
  "3) Uma dica de memorização do conteúdo envolvido (memoryTip);",
  "4) Pegadinhas comuns que fazem candidatos errarem questões assim (commonTraps).",
  "Responda SOMENTE com um objeto JSON no formato",
  '{"whyCorrect":"...","whyWrong":{"A":"...","B":"..."},"memoryTip":"...","commonTraps":"..."}',
  "— sem cercas de código e sem comentários.",
].join(" ");

// Shape of one AI-generated explanation (stored as jsonb in oab_questions).
export type AiExplanation = {
  whyCorrect: string;
  whyWrong: Record<string, string>;
  memoryTip: string;
  commonTraps: string;
};

export const aiExplanationSchema = z.object({
  whyCorrect: z.string().min(1),
  whyWrong: z.record(z.string(), z.string()),
  memoryTip: z.string().min(1),
  commonTraps: z.string().min(1),
});

export type ExplainInput = {
  questionText: string;
  options: string[];
  correctAnswer: string;
  legalBasis: string | null;
};

// Build the user message (the data half of the explanation prompt). Options are
// labelled A/B/C/D — English letter codes become the `whyWrong` keys in the JSON,
// matching the convention (no pt-BR literals as JSON keys).
export function buildExplainUserMessage(input: ExplainInput): string {
  const letters = ["A", "B", "C", "D", "E"];
  const optionLines = input.options
    .map((opt, i) => `${letters[i] ?? String(i + 1)}: ${opt}`)
    .join("\n");
  const parts = [
    `Questão:\n${input.questionText}`,
    `\nAlternativas:\n${optionLines}`,
    `\nAlternativa correta: ${input.correctAnswer}`,
    input.legalBasis !== null && input.legalBasis.length > 0
      ? `\nBase legal: ${input.legalBasis}`
      : "",
    "\nGere a explicação nos 4 pilares em JSON.",
  ];
  return parts.join("");
}

// Parse the relay's raw text into an AiExplanation. Tolerant of stray prose or
// code fences around the JSON. Returns null if the response is invalid.
export function parseExplainResponse(text: string): AiExplanation | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const result = aiExplanationSchema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

// ── Relay contract (mirrors mrhewbuc-issues task=complete) ────────────────────

// What the browser POSTs to the relay's payload. Provider-agnostic: names no vendor.
export type AiCompletePayload = {
  system?: string;
  user: string;
  json?: boolean;
  maxOutputTokens?: number;
};

export const aiCompleteResponseSchema = z.object({ text: z.string() });
export type AiCompleteResponse = z.infer<typeof aiCompleteResponseSchema>;
