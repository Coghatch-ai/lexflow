// shared/domain/flashcard.ts
//
// Pure domain types and functions for the flashcard feature. No DB or network
// dependencies — importable by both api/ and apps/mobile/.

import type { AiExplanation } from "./ai-eval";

/** Minimal shape of a flashcard card surfaced to the client. */
export type FlashcardCard = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  discipline: string;
  /** Formatted back-of-card explanation text (plain text, pt-BR). */
  back: string;
};

/**
 * Builds the back-of-card text from a question row.
 * Priority: format the 4-pillar AiExplanation when present; fall back to the
 * always-present plain `explanation` field.
 */
export function flashcardBack(q: {
  aiExplanation: AiExplanation | null | undefined;
  explanation: string;
}): string {
  const ai = q.aiExplanation;
  if (ai !== null && ai !== undefined && ai.whyCorrect.length > 0) {
    const wrongLines = Object.entries(ai.whyWrong)
      .map(([opt, reason]) => `${opt}: ${reason}`)
      .join("\n");
    return [
      `Por que está certa:\n${ai.whyCorrect}`,
      wrongLines.length > 0 ? `Por que as outras estão erradas:\n${wrongLines}` : "",
      `Dica de memória:\n${ai.memoryTip}`,
      `Armadilhas comuns:\n${ai.commonTraps}`,
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return q.explanation;
}

/**
 * Map a raw question DB row to a FlashcardCard.
 * The row type is intentionally loose so both dueQueue and newBatch selects
 * can call this without needing identical shapes.
 */
export function toFlashcardCard(row: {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  discipline: string;
  explanation: string;
  aiExplanation: AiExplanation | null | undefined;
}): FlashcardCard {
  return {
    id: row.id,
    questionText: row.questionText,
    options: row.options,
    correctAnswer: row.correctAnswer,
    discipline: row.discipline,
    back: flashcardBack(row),
  };
}
