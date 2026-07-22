import { describe, expect, it } from "vitest";
import {
  buildTutorVariables,
  parseTutorResponse,
  tutorRequestText,
  type TutorInput,
} from "./ai-tutor";

const baseInput: TutorInput = {
  questionText: "Qual o prazo?",
  options: ["10 dias", "15 dias", "20 dias", "30 dias"],
  correctAnswer: "15 dias",
  explanation: "O prazo é de 15 dias (art. 335 do CPC).",
  legalBasis: "CPC art. 335",
  userAnswer: "30 dias",
  mode: "why_my_answer_wrong",
  followUp: null,
};

describe("buildTutorVariables", () => {
  it("flattens options with letters and letters both answers", () => {
    const vars = buildTutorVariables(baseInput);
    expect(vars["options"]).toBe("A: 10 dias\nB: 15 dias\nC: 20 dias\nD: 30 dias");
    expect(vars["correctAnswer"]).toBe("B: 15 dias");
    expect(vars["userAnswer"]).toBe("D: 30 dias");
  });

  it("falls back when userAnswer/legalBasis are missing", () => {
    const vars = buildTutorVariables({ ...baseInput, userAnswer: null, legalBasis: null });
    expect(vars["userAnswer"]).toBe("(não informada)");
    expect(vars["legalBasis"]).toBe("(não informada)");
  });

  it("keeps an answer verbatim when it is not among the options", () => {
    const vars = buildTutorVariables({ ...baseInput, userAnswer: "45 dias" });
    expect(vars["userAnswer"]).toBe("45 dias");
  });

  it("uses the free-text follow-up as the request in free_text mode", () => {
    const vars = buildTutorVariables({
      ...baseInput,
      mode: "free_text",
      followUp: "E se o réu for revel?",
    });
    expect(vars["request"]).toBe("E se o réu for revel?");
  });
});

describe("tutorRequestText", () => {
  it("returns a non-empty pt-BR request for every fixed mode", () => {
    expect(tutorRequestText("explain_differently", null)).toContain("Explique");
    expect(tutorRequestText("why_my_answer_wrong", null)).toContain("pegadinha");
    expect(tutorRequestText("give_example", null)).toContain("exemplo");
  });

  it("returns empty string for free_text without follow-up", () => {
    expect(tutorRequestText("free_text", null)).toBe("");
  });
});

describe("parseTutorResponse (plain text, JSON-tolerant)", () => {
  it("accepts plain text (the streamed contract)", () => {
    expect(parseTutorResponse("Porque o prazo é de 15 dias (art. 335 do CPC).")).toEqual({
      answer: "Porque o prazo é de 15 dias (art. 335 do CPC).",
    });
  });

  it("still accepts the legacy JSON shape", () => {
    expect(parseTutorResponse('{"answer":"Porque o prazo é de 15 dias."}')).toEqual({
      answer: "Porque o prazo é de 15 dias.",
    });
  });

  it("strips code fences", () => {
    expect(parseTutorResponse("```\nO art. 335 fixa 15 dias.\n```")).toEqual({
      answer: "O art. 335 fixa 15 dias.",
    });
  });

  it("treats malformed/foreign JSON as plain text, rejects empty", () => {
    expect(parseTutorResponse('{"resposta":"x"}')).toEqual({ answer: '{"resposta":"x"}' });
    expect(parseTutorResponse("   ")).toBeNull();
    expect(parseTutorResponse("")).toBeNull();
  });
});
