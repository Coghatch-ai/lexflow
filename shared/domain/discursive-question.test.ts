import { describe, expect, it } from "vitest";
import { toRows, type DiscursiveDraft } from "./discursive-question";

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
