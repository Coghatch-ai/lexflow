// api/lib/ai-prompts.test.ts
//
// Unit tests for resolveAiPrompt provider/model threading.

import { describe, expect, it } from "vitest";
import { resolveAiPrompt } from "./ai-prompts";

const explainVars = {
  questionText: "Q",
  options: "A: X\nB: Y",
  correctAnswer: "A",
  legalBasis: "(não informada)",
};

describe("resolveAiPrompt — provider threading", () => {
  it("omits provider and model when no options passed", () => {
    const p = resolveAiPrompt("oab-explain", explainVars);
    expect(p.provider).toBeUndefined();
    expect(p.model).toBeUndefined();
  });

  it("threads provider through when supplied", () => {
    const p = resolveAiPrompt("oab-explain", explainVars, { provider: "openai" });
    expect(p.provider).toBe("openai");
    expect(p.model).toBeUndefined();
  });

  it("threads both provider and model through when supplied", () => {
    const p = resolveAiPrompt("oab-explain", explainVars, {
      provider: "openai",
      model: "gpt-4o",
    });
    expect(p.provider).toBe("openai");
    expect(p.model).toBe("gpt-4o");
  });

  it("threads gemini provider through", () => {
    const p = resolveAiPrompt(
      "oab-grade",
      {
        statement: "S",
        studentAnswer: "A",
        modelAnswer: "M",
        legalBasis: "(não informada)",
        maxPoints: "1.25",
      },
      { provider: "gemini", model: "gemini-2.0-flash" },
    );
    expect(p.provider).toBe("gemini");
    expect(p.model).toBe("gemini-2.0-flash");
  });

  it("always sets channel ai and json true", () => {
    const p = resolveAiPrompt("oab-explain", explainVars, { provider: "openai" });
    expect(p.channel).toBe("ai");
    expect(p.json).toBe(true);
  });
});
