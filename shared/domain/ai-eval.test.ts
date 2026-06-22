import { describe, expect, it } from "vitest";
import { aiCompleteResponseSchema, buildGradeUserMessage, parseGradeResponse } from "./ai-eval";

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
