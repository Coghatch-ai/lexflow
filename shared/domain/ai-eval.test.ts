import { describe, expect, it } from "vitest";
import {
  aiCompleteResponseSchema,
  buildExplainUserMessage,
  buildGradeUserMessage,
  parseExplainResponse,
  parseGradeResponse,
} from "./ai-eval";

describe("buildGradeUserMessage", () => {
  it("includes the data and a padrão-missing note when absent", () => {
    const msg = buildGradeUserMessage({
      statement: "Situação X",
      studentAnswer: "Minha resposta",
      modelAnswer: null,
      legalBasis: "CC art. 938",
      maxPoints: 1.25,
    });
    expect(msg).toContain("Situação X");
    expect(msg).toContain("Minha resposta");
    expect(msg).toContain("CC art. 938");
    expect(msg).toContain("não disponível");
  });
});

describe("parseGradeResponse", () => {
  it("extracts and clamps a score from JSON with surrounding prose", () => {
    const r = parseGradeResponse('Aqui: {"score": 2, "feedback": "Boa."} fim', 1.25);
    expect(r).toEqual({ score: 1.25, feedback: "Boa." }); // clamped to maxPoints
  });

  it("rounds and keeps in-range scores", () => {
    const r = parseGradeResponse('{"score": 0.666, "feedback": "ok"}', 1.25);
    expect(r?.score).toBe(0.67);
  });

  it("returns null when there is no JSON object", () => {
    expect(parseGradeResponse("sem json aqui", 1.25)).toBeNull();
  });
});

describe("aiCompleteResponseSchema", () => {
  it("parses { text }", () => {
    const parsed = aiCompleteResponseSchema.parse({ text: "hi" });
    expect(parsed.text).toBe("hi");
  });
});

describe("buildExplainUserMessage", () => {
  it("includes question text, options with letter labels, correct answer, and legal basis", () => {
    const msg = buildExplainUserMessage({
      questionText: "Questão sobre contrato",
      options: ["Nula", "Anulável", "Válida", "Ineficaz"],
      correctAnswer: "Anulável",
      legalBasis: "CC art. 171",
    });
    expect(msg).toContain("Questão sobre contrato");
    expect(msg).toContain("A: Nula");
    expect(msg).toContain("B: Anulável");
    expect(msg).toContain("Alternativa correta: Anulável");
    expect(msg).toContain("CC art. 171");
  });

  it("omits base legal line when legalBasis is null", () => {
    const msg = buildExplainUserMessage({
      questionText: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      legalBasis: null,
    });
    expect(msg).not.toContain("Base legal");
  });
});

describe("parseExplainResponse", () => {
  const valid = JSON.stringify({
    whyCorrect: "Está correto porque...",
    whyWrong: { A: "errada por X", B: "errada por Y" },
    memoryTip: "Lembre-se de...",
    commonTraps: "Candidatos confundem...",
  });

  it("parses a well-formed 4-pilar JSON", () => {
    const result = parseExplainResponse(valid);
    expect(result).not.toBeNull();
    expect(result?.whyCorrect).toBe("Está correto porque...");
    expect(result?.whyWrong["A"]).toBe("errada por X");
    expect(result?.memoryTip).toBe("Lembre-se de...");
    expect(result?.commonTraps).toBe("Candidatos confundem...");
  });

  it("tolerates prose and code fences surrounding the JSON", () => {
    const wrapped = `Aqui está a explicação:\n\`\`\`json\n${valid}\n\`\`\`\nFim.`;
    expect(parseExplainResponse(wrapped)).not.toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(parseExplainResponse("sem json aqui")).toBeNull();
  });

  it("returns null when a required pillar is missing", () => {
    const missing = JSON.stringify({ whyCorrect: "ok", whyWrong: {}, memoryTip: "ok" });
    expect(parseExplainResponse(missing)).toBeNull();
  });

  it("returns null when whyWrong is not a record of strings", () => {
    const bad = JSON.stringify({
      whyCorrect: "ok",
      whyWrong: "not a record",
      memoryTip: "ok",
      commonTraps: "ok",
    });
    expect(parseExplainResponse(bad)).toBeNull();
  });
});
