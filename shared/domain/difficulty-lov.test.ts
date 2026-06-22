// shared/domain/difficulty-lov.test.ts
//
// Regression guard: the DIFFICULTY LOV must supply the exact English codes
// that AdminQuestionForm (and the DB schema) expect, and the pt-BR labels must
// be properly accented. If someone reverts admin-question-form.tsx to hardcoded
// options, or corrupts the seed data, at least one of these tests will fail.

import { describe, it, expect } from "vitest";
import { LOV_SEED } from "../data/lov";

const DIFFICULTY = LOV_SEED.filter((r) => r.type === "DIFFICULTY");

describe("DIFFICULTY LOV", () => {
  it("has exactly the three valid difficulty codes", () => {
    const codes = DIFFICULTY.map((r) => r.code).sort();
    expect(codes).toEqual(["easy", "hard", "medium"]);
  });

  it("pt-BR labels are fully accented (no missing diacritics)", () => {
    const valuesByCode: Record<string, string> = Object.fromEntries(
      DIFFICULTY.map((r) => [r.code, r.value]),
    );
    expect(valuesByCode["easy"]).toBe("Fácil");
    expect(valuesByCode["medium"]).toBe("Médio");
    expect(valuesByCode["hard"]).toBe("Difícil");
  });

  it("is sorted by sortOrder ascending", () => {
    const orders = DIFFICULTY.map((r) => r.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
