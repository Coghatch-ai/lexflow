// shared/domain/ai-eval.ts
//
// AI evaluation for OAB questions: grading for discursive answers (2ª fase) and
// explanation generation for objective questions (1ª fase). The actual model call
// goes through the central mrhewbuc relay (project=lexflow, task=complete) — a
// thin LLM proxy that owns the system prompt and user template server-side.
// The client sends only the variable values; the relay handles prompt assembly.
// Reply parsing stays here in the calling app. See relay v2 contract below.

import { z } from "zod";
import { clampScore } from "./discursive-attempt";

// ── 2ª-fase discursive grading ────────────────────────────────────────────────

export type GradeInput = {
  statement: string;
  studentAnswer: string;
  modelAnswer: string | null;
  legalBasis: string | null;
  maxPoints: number;
};

// Build the flat variable map for the relay's "oab-grade" prompt.
// Null/empty optional fields are resolved to their fallback strings here —
// the relay does flat substitution with no conditionals.
export function buildGradeVariables(input: GradeInput): Record<string, string> {
  return {
    statement: input.statement,
    studentAnswer: input.studentAnswer,
    modelAnswer:
      input.modelAnswer !== null && input.modelAnswer.length > 0
        ? input.modelAnswer
        : "(não disponível — avalie pela técnica jurídica)",
    legalBasis:
      input.legalBasis !== null && input.legalBasis.length > 0
        ? input.legalBasis
        : "(não informada)",
    maxPoints: String(input.maxPoints),
  };
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

// Build the flat variable map for the relay's "oab-explain" prompt.
// Options are flattened to labelled lines ("A: ...\nB: ...") here before
// sending — the relay does flat string substitution only.
export function buildExplainVariables(input: ExplainInput): Record<string, string> {
  const letters = ["A", "B", "C", "D", "E"];
  const options = input.options
    .map((opt, i) => `${letters[i] ?? String(i + 1)}: ${opt}`)
    .join("\n");
  return {
    questionText: input.questionText,
    options,
    correctAnswer: input.correctAnswer,
    legalBasis:
      input.legalBasis !== null && input.legalBasis.length > 0
        ? input.legalBasis
        : "(não informada)",
  };
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

// ── Relay v2 contract ─────────────────────────────────────────────────────────
//
// POST { project: "lexflow", task: "complete", payload: AiCompletePayload }
// with Authorization: Bearer <clerk-token>
//
// The relay owns the system prompt, user template, json flag, and maxOutputTokens.
// The client sends ONLY the promptId and the declared variable values (flat strings).
// Missing or extra variables return 400. Old {system, user} shape returns 400.

export type AiCompletePayload = {
  promptId: string;
  variables: Record<string, string>;
};

export const aiCompleteResponseSchema = z.object({ text: z.string() });
export type AiCompleteResponse = z.infer<typeof aiCompleteResponseSchema>;
