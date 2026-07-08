import { describe, expect, it } from "vitest";
import { flashcardBack, toFlashcardCard } from "./flashcard";
import type { AiExplanation } from "./ai-eval";

const EXPLANATION = "A alternativa correta é a B por causa do art. 5º da CF.";

const AI_EXPLANATION: AiExplanation = {
  whyCorrect: "A opção B aplica o princípio da legalidade.",
  whyWrong: {
    A: "Confunde direito adquirido com expectativa de direito.",
    C: "Ignora a hierarquia das normas.",
  },
  memoryTip: "Legalidade = lei prévia.",
  commonTraps: "Candidatos confundem a letra A com a letra B.",
};

describe("flashcardBack", () => {
  it("returns formatted 4-pillar text when aiExplanation is present", () => {
    const result = flashcardBack({ aiExplanation: AI_EXPLANATION, explanation: EXPLANATION });
    expect(result).toContain("Por que está certa:");
    expect(result).toContain(AI_EXPLANATION.whyCorrect);
    expect(result).toContain("Por que as outras estão erradas:");
    expect(result).toContain("A: Confunde direito adquirido");
    expect(result).toContain("Dica de memória:");
    expect(result).toContain(AI_EXPLANATION.memoryTip);
    expect(result).toContain("Armadilhas comuns:");
    expect(result).toContain(AI_EXPLANATION.commonTraps);
    expect(result).not.toBe(EXPLANATION);
  });

  it("returns raw explanation when aiExplanation is null", () => {
    const result = flashcardBack({ aiExplanation: null, explanation: EXPLANATION });
    expect(result).toBe(EXPLANATION);
  });

  it("returns raw explanation when aiExplanation is undefined", () => {
    const result = flashcardBack({ aiExplanation: undefined, explanation: EXPLANATION });
    expect(result).toBe(EXPLANATION);
  });

  it("returns raw explanation when aiExplanation has empty whyCorrect", () => {
    const empty: AiExplanation = { ...AI_EXPLANATION, whyCorrect: "" };
    const result = flashcardBack({ aiExplanation: empty, explanation: EXPLANATION });
    expect(result).toBe(EXPLANATION);
  });
});

describe("toFlashcardCard", () => {
  const baseRow = {
    id: "q-001",
    questionText: "Qual é o prazo prescricional?",
    options: ["1 ano", "2 anos", "3 anos", "5 anos"],
    correctAnswer: "3 anos",
    discipline: "CIVIL_LAW",
    explanation: EXPLANATION,
    aiExplanation: null as AiExplanation | null,
  };

  it("produces correct card shape with fallback back", () => {
    const card = toFlashcardCard(baseRow);
    expect(card.id).toBe("q-001");
    expect(card.questionText).toBe("Qual é o prazo prescricional?");
    expect(card.options).toHaveLength(4);
    expect(card.correctAnswer).toBe("3 anos");
    expect(card.discipline).toBe("CIVIL_LAW");
    expect(card.back).toBe(EXPLANATION);
  });

  it("uses formatted back when aiExplanation present", () => {
    const card = toFlashcardCard({ ...baseRow, aiExplanation: AI_EXPLANATION });
    expect(card.back).toContain("Por que está certa:");
  });
});
