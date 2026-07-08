// shared/data/oab-questions.test.ts
//
// Verifies that the mock question generator emits only discipline codes that
// exist in the LOV — catching name-drift bugs like "Trabalhista"/"Comercial".

import { describe, it, expect } from "vitest";
import { generateOabQuestions } from "./oab-questions";
import { LOV_SEED } from "./lov";

describe("generateOabQuestions", () => {
  const validCodes = new Set(LOV_SEED.filter((r) => r.type === "DISCIPLINE").map((r) => r.code));

  it("every question discipline is a known LOV code", () => {
    const questions = generateOabQuestions();
    for (const q of questions) {
      expect(validCodes.has(q.discipline), `unknown discipline code: "${q.discipline}"`).toBe(true);
    }
  });
});
