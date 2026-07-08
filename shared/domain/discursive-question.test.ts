import { describe, expect, it } from "vitest";
import {
  toRows,
  SECOND_PHASE_AREA_CODES,
  isSecondPhaseArea,
  type DiscursiveDraft,
} from "./discursive-question";

const draft: DiscursiveDraft = {
  examLabel: "XL Exame Unificado",
  examBoard: "FGV",
  year: 2024,
  area: "CIVIL_LAW",
  items: [
    {
      questionType: "PECA_PRATICA",
      orderIndex: 0,
      statement: "Elabore a peça...",
      modelAnswer: "Petição inicial...",
      maxPoints: 5,
      maxLines: 0,
      legalBasis: "",
      topic: "Responsabilidade civil",
    },
    {
      questionType: "DISCURSIVE",
      orderIndex: 1,
      statement: "Questão 1...",
      modelAnswer: "",
      maxPoints: 1.25,
      maxLines: 30,
      legalBasis: "CC art. 186",
      topic: "",
    },
  ],
};

describe("SECOND_PHASE_AREA_CODES / isSecondPhaseArea", () => {
  it("contains exactly the 7 valid 2ª-fase discipline codes", () => {
    expect([...SECOND_PHASE_AREA_CODES].sort()).toEqual(
      [
        "ADMINISTRATIVE_LAW",
        "CIVIL_LAW",
        "COMMERCIAL_LAW",
        "CONSTITUTIONAL_LAW",
        "CRIMINAL_LAW",
        "LABOR_LAW",
        "TAX_LAW",
      ].sort(),
    );
  });

  it("returns true for every valid 2ª-fase code", () => {
    for (const code of SECOND_PHASE_AREA_CODES) {
      expect(isSecondPhaseArea(code), code).toBe(true);
    }
  });

  it("returns false for codes not in 2ª-fase (1ª-fase-only disciplines)", () => {
    for (const code of [
      "CIVIL_PROCEDURE",
      "CRIMINAL_PROCEDURE",
      "ENVIRONMENTAL_LAW",
      "LEGAL_ETHICS",
    ]) {
      expect(isSecondPhaseArea(code), code).toBe(false);
    }
  });
});

describe("toRows", () => {
  it("derives deterministic ids from exam + area + position (idempotent upsert key)", () => {
    const ids = toRows(draft).map((r) => r.id);
    expect(ids).toEqual([
      "di-xl-exame-unificado-civil-law-peca",
      "di-xl-exame-unificado-civil-law-q1",
    ]);
    // Same draft -> same ids, so re-saving updates instead of duplicating.
    expect(toRows(draft).map((r) => r.id)).toEqual(ids);
  });

  it("normalizes empty strings and 0 line-limits to null, fixes phase to '2nd'", () => {
    const [peca, q1] = toRows(draft);
    expect(peca?.phase).toBe("2nd");
    expect(peca?.maxLines).toBeNull(); // 0 -> null
    expect(peca?.legalBasis).toBeNull(); // "" -> null
    expect(peca?.modelAnswer).toBe("Petição inicial...");
    expect(q1?.maxLines).toBe(30);
    expect(q1?.modelAnswer).toBeNull(); // "" -> null
    expect(q1?.topic).toBeNull();
  });
});
