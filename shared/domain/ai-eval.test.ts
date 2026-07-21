import { describe, expect, it } from "vitest";
import {
  buildExplainVariables,
  buildGradeVariables,
  optionLetter,
  parseExplainResponse,
  parseGradeResponse,
  stripCorrectLetterFromWhyWrong,
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

  it("strips correct letter from whyWrong when correctLetter provided", () => {
    const payload = JSON.stringify({
      whyCorrect: "A alternativa correta é a letra D — porque X.",
      whyWrong: { A: "errada A", B: "errada B", C: "errada C", D: "errada D (vaza)" },
      memoryTip: "Dica",
      commonTraps: "Pegadinha",
    });
    const result = parseExplainResponse(payload, "D");
    expect(result).not.toBeNull();
    expect(Object.keys(result?.whyWrong ?? {})).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(result?.whyWrong).not.toHaveProperty("D");
  });

  it("strips drifted key 'letra D' when correctLetter is D", () => {
    const payload = JSON.stringify({
      whyCorrect: "A alternativa correta é a letra D — porque X.",
      whyWrong: { A: "errada A", B: "errada B", "letra D": "errada D drift" },
      memoryTip: "Dica",
      commonTraps: "Pegadinha",
    });
    const result = parseExplainResponse(payload, "D");
    expect(result).not.toBeNull();
    expect(result?.whyWrong).not.toHaveProperty("D");
    expect(result?.whyWrong).not.toHaveProperty("letra D");
  });

  it("strips lowercase drifted key ' d ' when correctLetter is D", () => {
    const payload = JSON.stringify({
      whyCorrect: "A alternativa correta é a letra D — porque X.",
      whyWrong: { A: "errada A", " d ": "errada D lowercase drift" },
      memoryTip: "Dica",
      commonTraps: "Pegadinha",
    });
    const result = parseExplainResponse(payload, "D");
    expect(result).not.toBeNull();
    expect(result?.whyWrong).not.toHaveProperty("D");
  });

  it("is a no-op (back-compat) when correctLetter is omitted", () => {
    const result = parseExplainResponse(valid);
    expect(result).not.toBeNull();
    expect(result?.whyWrong).toHaveProperty("A");
    expect(result?.whyWrong).toHaveProperty("B");
  });
});

describe("optionLetter", () => {
  const opts = ["opt A text", "opt B text", "opt C text", "opt D text"];

  it("returns correct letter for each index", () => {
    expect(optionLetter(opts, "opt A text")).toBe("A");
    expect(optionLetter(opts, "opt B text")).toBe("B");
    expect(optionLetter(opts, "opt D text")).toBe("D");
  });

  it("returns undefined when correctAnswer not found in options", () => {
    expect(optionLetter(opts, "not present")).toBeUndefined();
  });

  it("returns undefined for empty options array", () => {
    expect(optionLetter([], "anything")).toBeUndefined();
  });
});

describe("stripCorrectLetterFromWhyWrong", () => {
  // These tests cover the admin saveAiExplanation defense-in-depth path:
  // drifted keys from older/pre-fix clients must be stripped even when the
  // whyWrong map was NOT built by parseExplainResponse (e.g. a client that
  // sent the payload before the parse-path fix was deployed).

  it("strips canonical key matching correctLetter", () => {
    const result = stripCorrectLetterFromWhyWrong(
      { A: "errada A", B: "errada B", C: "errada C", D: "errada D (vaza)" },
      "D",
    );
    expect(result).not.toHaveProperty("D");
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });

  it("strips drifted key 'letra D' when correctLetter is D", () => {
    const result = stripCorrectLetterFromWhyWrong(
      { A: "errada A", B: "errada B", "letra D": "errada D drift" },
      "D",
    );
    expect(result).not.toHaveProperty("D");
    expect(result).not.toHaveProperty("letra D");
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("strips drifted key ' d ' (lowercase, padded) when correctLetter is D", () => {
    const result = stripCorrectLetterFromWhyWrong(
      { A: "errada A", " d ": "errada D lowercase drift" },
      "D",
    );
    expect(result).not.toHaveProperty("D");
    expect(result).not.toHaveProperty(" d ");
    expect(result).toHaveProperty("A");
  });

  it("canonicalizes keys even when correctLetter is undefined (no strip, just normalize)", () => {
    const result = stripCorrectLetterFromWhyWrong(
      { "letra A": "errada A", " b ": "errada B" },
      undefined,
    );
    expect(result).toHaveProperty("A");
    expect(result).toHaveProperty("B");
    expect(result).not.toHaveProperty("letra A");
    expect(result).not.toHaveProperty(" b ");
  });

  it("is a no-op on an already-clean map with matching canonical key", () => {
    const input = { A: "errada A", B: "errada B", C: "errada C" };
    const result = stripCorrectLetterFromWhyWrong(input, "D");
    expect(result).toEqual({ A: "errada A", B: "errada B", C: "errada C" });
  });
});

// Regression: gpt-5.4-mini nested memoryTip+commonTraps inside whyWrong instead
// of hoisting them to the top level → aiExplanationSchema.safeParse failed →
// parseExplainResponse returned null → 502 "A IA retornou um formato inesperado".
// Shape taken verbatim from the real S3 relay result for job fd32ecce-… (issue #47).
describe("parseExplainResponse — nested-pillars recovery (issue #47 regression)", () => {
  const nestedShape = JSON.stringify({
    whyCorrect:
      "A alternativa correta é a letra D — nas compras realizadas fora do estabelecimento comercial, especialmente em ambiente virtual, o consumidor tem direito de arrependimento no prazo de 7 dias a contar do recebimento do produto, nos termos do art. 49 do CDC.",
    whyWrong: {
      A: "Errada. O direito de arrependimento não exige motivação e não está condicionado ao decurso de 48 horas da transação.",
      B: "Errada. O fornecedor não pode impor ao consumidor a apresentação de justificativa como condição para exercer o arrependimento.",
      C: "Errada. A boa-fé objetiva não autoriza o fornecedor a criar requisito não previsto em lei.",
      memoryTip:
        "Lembre da regra: compra fora da loja = 7 dias para voltar atrás, sem dar explicação.",
      commonTraps:
        "1) Confundir o prazo legal de 7 dias com 48 horas. 2) Achar que o fornecedor pode exigir justificativa.",
    },
  });

  it("recovers nested memoryTip+commonTraps and returns a valid AiExplanation", () => {
    const result = parseExplainResponse(nestedShape);
    expect(result).not.toBeNull();
    expect(result?.memoryTip).toContain("7 dias");
    expect(result?.commonTraps).toContain("48 horas");
  });

  it("whyWrong contains only letter keys after recovery", () => {
    const result = parseExplainResponse(nestedShape);
    expect(result).not.toBeNull();
    const keys = Object.keys(result?.whyWrong ?? {});
    expect(keys).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(keys).not.toContain("memoryTip");
    expect(keys).not.toContain("commonTraps");
  });

  it("strips correct letter from whyWrong after recovery", () => {
    const result = parseExplainResponse(nestedShape, "D");
    expect(result).not.toBeNull();
    expect(result?.whyWrong).not.toHaveProperty("D");
    expect(Object.keys(result?.whyWrong ?? {})).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });

  it("top-level memoryTip wins over nested when both present and non-empty", () => {
    const mixedShape = JSON.stringify({
      whyCorrect: "A alternativa correta é a letra D — explicação.",
      whyWrong: {
        A: "Errada A.",
        memoryTip: "nested tip (should be ignored)",
        commonTraps: "nested traps (used because top-level empty).",
      },
      memoryTip: "top-level tip (should win)",
      commonTraps: "",
    });
    // top-level commonTraps is "" → fails min(1) → recovery lifts nested one.
    const result = parseExplainResponse(mixedShape);
    expect(result?.memoryTip).toBe("top-level tip (should win)");
    expect(result?.commonTraps).toContain("nested traps");
  });
});
