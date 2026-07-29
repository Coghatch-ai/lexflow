// api/lib/ai-prompts.test.ts
//
// Unit tests for resolveAiPrompt provider/model threading.

import { describe, expect, it } from "vitest";
import { AI_PROMPTS, resolveAiPrompt, type PromptId } from "./ai-prompts";

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

describe("oab-explain system prompt — whyCorrect opening mandate", () => {
  // Regression for #40: whyCorrect must be instructed to open with the correct letter.
  // Model output is non-deterministic; this test guards the prompt contract, not model behaviour.
  it("mandates whyCorrect opens with correct-letter sentence", () => {
    const p = resolveAiPrompt("oab-explain", explainVars);
    expect(p.system).toMatch(
      /whyCorrect.*DEVE começar obrigatoriamente com "A alternativa correta é a letra/,
    );
  });

  it("mandate appears before whyWrong instruction", () => {
    const p = resolveAiPrompt("oab-explain", explainVars);
    const mandateIdx = p.system.indexOf("DEVE começar obrigatoriamente");
    const whyWrongIdx = p.system.indexOf("whyWrong");
    expect(mandateIdx).toBeGreaterThan(-1);
    expect(mandateIdx).toBeLessThan(whyWrongIdx);
  });
});

// Regression for #62: OpenAI's json_object format rejects the request (400) unless
// the literal word "json" appears in the INPUT message. openaiComplete routes the
// system prompt to `instructions` (which does NOT count) and the user prompt to
// `input` — so every json:true prompt MUST carry "json" in its USER template, not
// just in system. oab-grade lacked it and failed only under the OpenAI provider
// (Gemini's response_mime_type masked the constraint). This guards grade + every
// future json prompt against the same trap.
describe("json:true prompts carry literal 'json' in the USER message (#62)", () => {
  const promptIds = Object.keys(AI_PROMPTS) as PromptId[];

  for (const id of promptIds) {
    const tmpl: { json?: boolean; vars: readonly string[] } = AI_PROMPTS[id];
    const effectiveJson = (tmpl.json ?? true) === true;
    if (!effectiveJson) continue;

    it(`${id}: resolved user text matches /json/i`, () => {
      const vars = Object.fromEntries(tmpl.vars.map((v) => [v, "x"]));
      const p = resolveAiPrompt(id, vars);
      expect(p.json).toBe(true);
      expect(p.user).toMatch(/json/i);
    });
  }
});
