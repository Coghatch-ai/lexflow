// app/src/pages/admin-question-form.test.ts
//
// Regression test for #41: extractWhyCorrect returns ONLY whyCorrect slice
// from a valid 4-pillar AI payload, and null on parse failure.
// Test imports production code — removing extractWhyCorrect or its wiring
// causes this suite to fail.

import { describe, expect, it } from "vitest";
import { extractWhyCorrect } from "./admin-question-form-helpers";

const MOCK_PAYLOAD = JSON.stringify({
  whyCorrect: "A alternativa A está correta porque o CC art. 205 prevê prazo de 10 anos.",
  whyWrong: {
    B: "Incorreta pois confunde prescrição com decadência.",
    C: "Incorreta pois o prazo é geral, não especial.",
    D: "Incorreta pois não se aplica ao caso.",
  },
  memoryTip: "10 anos = regra geral CC.",
  commonTraps: "Confundir prescrição com decadência.",
});

describe("extractWhyCorrect (#41 regression guard)", () => {
  it("returns only whyCorrect string for valid 4-pillar payload", () => {
    const result = extractWhyCorrect(MOCK_PAYLOAD);
    expect(result).toBe(
      "A alternativa A está correta porque o CC art. 205 prevê prazo de 10 anos.",
    );
    // Must NOT return the full JSON blob
    expect(result).not.toBe(MOCK_PAYLOAD);
  });

  it("does not return whyWrong, memoryTip or commonTraps content", () => {
    const result = extractWhyCorrect(MOCK_PAYLOAD);
    expect(result).not.toContain("whyWrong");
    expect(result).not.toContain("memoryTip");
    expect(result).not.toContain("commonTraps");
  });

  it("returns null for malformed / non-JSON payload", () => {
    expect(extractWhyCorrect("not-json")).toBeNull();
    expect(extractWhyCorrect("{}")).toBeNull();
    expect(extractWhyCorrect("")).toBeNull();
  });
});
