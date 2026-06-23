import { describe, expect, it } from "vitest";
import {
  aiCompleteResponseSchema,
  buildExplainVariables,
  buildGradeVariables,
  parseExplainResponse,
  parseGradeResponse,
} from "./ai-eval";

describe("buildGradeVariables", () => {
  it("returns all five expected keys", () => {
    const vars = buildGradeVariables({
      statement: "Situação X",
      studentAnswer: "Minha resposta",
      modelAnswer: "Padrão oficial",
      legalBasis: "CC art. 938",
      maxPoints: 1.25,
    });
    expect(Object.keys(vars).sort()).toEqual(
      ["legalBasis", "maxPoints", "modelAnswer", "statement", "studentAnswer"].sort(),
    );
  });

  it("all values are strings", () => {
    const vars = buildGradeVariables({
      statement: "S",
      studentAnswer: "A",
      modelAnswer: "M",
      legalBasis: "L",
      maxPoints: 5,
    });
    for (const v of Object.values(vars)) {
      expect(typeof v).toBe("string");
    }
  });

  it("resolves null modelAnswer to the fallback string", () => {
    const vars = buildGradeVariables({
      statement: "S",
      studentAnswer: "A",
      modelAnswer: null,
      legalBasis: "L",
      maxPoints: 1.25,
    });
    expect(vars["modelAnswer"]).toBe("(não disponível — avalie pela técnica jurídica)");
  });

  it("resolves empty modelAnswer to the fallback string", () => {
    const vars = buildGradeVariables({
      statement: "S",
      studentAnswer: "A",
      modelAnswer: "",
      legalBasis: "L",
      maxPoints: 1.25,
    });
    expect(vars["modelAnswer"]).toBe("(não disponível — avalie pela técnica jurídica)");
  });

  it("resolves null legalBasis to the fallback string", () => {
    const vars = buildGradeVariables({
      statement: "S",
      studentAnswer: "A",
      modelAnswer: "M",
      legalBasis: null,
      maxPoints: 1.25,
    });
    expect(vars["legalBasis"]).toBe("(não informada)");
  });

  it("converts maxPoints to its string form", () => {
    const vars = buildGradeVariables({
      statement: "S",
      studentAnswer: "A",
      modelAnswer: "M",
      legalBasis: "L",
      maxPoints: 1.25,
    });
    expect(vars["maxPoints"]).toBe("1.25");
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

describe("buildExplainVariables", () => {
  it("returns all four expected keys", () => {
    const vars = buildExplainVariables({
      questionText: "Q",
      options: ["Nula", "Anulável", "Válida", "Ineficaz"],
      correctAnswer: "Anulável",
      legalBasis: "CC art. 171",
    });
    expect(Object.keys(vars).sort()).toEqual(
      ["correctAnswer", "legalBasis", "options", "questionText"].sort(),
    );
  });

  it("all values are strings", () => {
    const vars = buildExplainVariables({
      questionText: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      legalBasis: null,
    });
    for (const v of Object.values(vars)) {
      expect(typeof v).toBe("string");
    }
  });

  it("flattens options with letter labels into one string", () => {
    const vars = buildExplainVariables({
      questionText: "Questão sobre contrato",
      options: ["Nula", "Anulável", "Válida", "Ineficaz"],
      correctAnswer: "Anulável",
      legalBasis: "CC art. 171",
    });
    expect(vars["options"]).toContain("A: Nula");
    expect(vars["options"]).toContain("B: Anulável");
    expect(vars["options"]).toContain("C: Válida");
    expect(vars["options"]).toContain("D: Ineficaz");
  });

  it("passes through questionText and correctAnswer verbatim", () => {
    const vars = buildExplainVariables({
      questionText: "Questão sobre contrato",
      options: ["X"],
      correctAnswer: "Anulável",
      legalBasis: null,
    });
    expect(vars["questionText"]).toBe("Questão sobre contrato");
    expect(vars["correctAnswer"]).toBe("Anulável");
  });

  it("resolves null legalBasis to the fallback string", () => {
    const vars = buildExplainVariables({
      questionText: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      legalBasis: null,
    });
    expect(vars["legalBasis"]).toBe("(não informada)");
  });

  it("resolves empty legalBasis to the fallback string", () => {
    const vars = buildExplainVariables({
      questionText: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      legalBasis: "",
    });
    expect(vars["legalBasis"]).toBe("(não informada)");
  });

  it("passes non-null legalBasis through verbatim", () => {
    const vars = buildExplainVariables({
      questionText: "Q",
      options: ["A"],
      correctAnswer: "A",
      legalBasis: "CC art. 171",
    });
    expect(vars["legalBasis"]).toBe("CC art. 171");
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
