// shared/domain/ai-tutor.ts
//
// Per-question AI tutor ("buddy") for 1ª-fase objective questions. The student
// asks about the question they just answered via fixed modes (explain
// differently / why was my answer wrong / give an example) or one bounded
// free-text follow-up. Variable builder + response parser are used SERVER-SIDE
// by ai.tutorAsk/tutorFinalize (api/trpc/routers/ai.router.ts), same split as
// ai-eval.ts: the API owns the prompt, this module owns variables + parsing.

import { z } from "zod";

export const TUTOR_MODES = [
  "explain_differently",
  "why_my_answer_wrong",
  "give_example",
  "free_text",
] as const;

export type TutorMode = (typeof TUTOR_MODES)[number];

export const TUTOR_FOLLOW_UP_MAX_CHARS = 500;

export type TutorInput = {
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  legalBasis: string | null;
  /** Option text the student selected; null when unknown (e.g. review flow). */
  userAnswer: string | null;
  mode: TutorMode;
  /** Required when mode === "free_text"; ignored otherwise. */
  followUp: string | null;
};

const LETTERS = ["A", "B", "C", "D", "E"];

function withLetter(options: string[], answer: string): string {
  const idx = options.indexOf(answer);
  const letter = idx === -1 ? undefined : LETTERS[idx];
  return letter === undefined ? answer : `${letter}: ${answer}`;
}

// The pt-BR request line sent to the model AND persisted as the user turn.
export function tutorRequestText(mode: TutorMode, followUp: string | null): string {
  switch (mode) {
    case "explain_differently":
      return "Explique a resposta correta de outra forma, mais simples e direta.";
    case "why_my_answer_wrong":
      return "Explique por que a alternativa que eu marquei está errada, qual foi a pegadinha da banca e como não cair nela de novo.";
    case "give_example":
      return "Dê um exemplo prático (caso concreto) aplicando a regra cobrada nesta questão.";
    case "free_text":
      return followUp ?? "";
  }
}

// Build the flat variable map for the server-owned "oab-tutor" prompt.
// Options are flattened to labelled lines; null/empty optionals get fallback
// strings here — the prompt does flat substitution with no conditionals.
export function buildTutorVariables(input: TutorInput): Record<string, string> {
  const options = input.options
    .map((opt, i) => `${LETTERS[i] ?? String(i + 1)}: ${opt}`)
    .join("\n");
  return {
    questionText: input.questionText,
    options,
    correctAnswer: withLetter(input.options, input.correctAnswer),
    userAnswer:
      input.userAnswer !== null && input.userAnswer.length > 0
        ? withLetter(input.options, input.userAnswer)
        : "(não informada)",
    explanation: input.explanation,
    legalBasis:
      input.legalBasis !== null && input.legalBasis.length > 0
        ? input.legalBasis
        : "(não informada)",
    request: tutorRequestText(input.mode, input.followUp),
  };
}

const tutorResponseSchema = z.object({ answer: z.string().min(1) });

// Parse the tutor reply. The prompt asks for PLAIN TEXT (so the streaming path
// can render tokens as they arrive), but models occasionally emit the old
// {"answer": "..."} JSON shape — accept both. Returns null only when empty.
export function parseTutorResponse(text: string): { answer: string } | null {
  const trimmed = text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = tutorResponseSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through — treat as plain text
    }
  }
  return trimmed.length > 0 ? { answer: trimmed } : null;
}
