import { describe, expect, it } from "vitest";
import {
  questionsPerDayCalc,
  planProgressPct,
  scoreRatioPct,
  weakestDisciplines,
  MIN_ANSWERED_1ST,
  MIN_ANSWERED_2ND,
} from "./study-plan";

describe("questionsPerDayCalc", () => {
  it("divides available questions over deadline days", () => {
    expect(questionsPerDayCalc(300, 30)).toBe(10);
  });
  it("rounds up fractional results", () => {
    expect(questionsPerDayCalc(31, 30)).toBe(2);
  });
  it("minimum is 1 when no questions available", () => {
    expect(questionsPerDayCalc(0, 30)).toBe(1);
  });
});

describe("planProgressPct", () => {
  it("computes partial progress", () => {
    expect(planProgressPct(10, 10, 2)).toBe(50);
  });
  it("caps at 100", () => {
    expect(planProgressPct(25, 10, 2)).toBe(100);
  });
  it("returns 0 for zero perDay", () => {
    expect(planProgressPct(10, 0, 5)).toBe(0);
  });
  it("returns 0 for zero elapsed", () => {
    expect(planProgressPct(10, 10, 0)).toBe(0);
  });
});

describe("weakestDisciplines", () => {
  const stats = [
    { discipline: "CRIMINAL_LAW", totalAnswered: 10, accuracy: 40 },
    { discipline: "CIVIL_LAW", totalAnswered: 8, accuracy: 55 },
    { discipline: "CONSTITUTIONAL_LAW", totalAnswered: 3, accuracy: 30 },
    { discipline: "TAX_LAW", totalAnswered: 12, accuracy: 35 },
    { discipline: "LABOR_LAW", totalAnswered: 6, accuracy: 60 },
  ];

  it("returns topN weakest disciplines above minAnswered threshold", () => {
    expect(weakestDisciplines(stats, 5, 3)).toEqual(["TAX_LAW", "CRIMINAL_LAW", "CIVIL_LAW"]);
  });

  it("excludes disciplines below minAnswered", () => {
    expect(weakestDisciplines(stats, 5, 3)).not.toContain("CONSTITUTIONAL_LAW");
  });

  it("returns fewer than topN when not enough qualified disciplines", () => {
    expect(weakestDisciplines(stats, 10, 3)).toEqual(["TAX_LAW", "CRIMINAL_LAW"]);
  });

  it("returns empty array when nothing qualifies", () => {
    expect(weakestDisciplines(stats, 50, 3)).toEqual([]);
  });

  it("works with discursive-style stats (area codes) using lower MIN_ANSWERED_2ND floor", () => {
    const discursiveStats = [
      { discipline: "CIVIL_LAW", totalAnswered: 5, accuracy: 60 },
      { discipline: "CRIMINAL_LAW", totalAnswered: 3, accuracy: 45 },
      { discipline: "LABOR_LAW", totalAnswered: 1, accuracy: 30 },
    ];
    // With MIN_ANSWERED_2ND=2, LABOR_LAW is excluded (only 1 answered); CRIMINAL_LAW qualifies
    expect(weakestDisciplines(discursiveStats, MIN_ANSWERED_2ND, 3)).toEqual([
      "CRIMINAL_LAW",
      "CIVIL_LAW",
    ]);
  });

  it("MIN_ANSWERED_1ST is 5 and MIN_ANSWERED_2ND is 2", () => {
    expect(MIN_ANSWERED_1ST).toBe(5);
    expect(MIN_ANSWERED_2ND).toBe(2);
  });
});

describe("scoreRatioPct", () => {
  it("computes percentage from score and maxPoints", () => {
    expect(scoreRatioPct(3, 5)).toBe(60);
  });

  it("rounds to nearest integer", () => {
    expect(scoreRatioPct(1, 3)).toBe(33);
  });

  it("returns null when score is null (ungraded — must not count as 0%)", () => {
    expect(scoreRatioPct(null, 5)).toBeNull();
  });

  it("returns null when score is undefined", () => {
    expect(scoreRatioPct(undefined, 5)).toBeNull();
  });

  it("returns null when maxPoints is null", () => {
    expect(scoreRatioPct(3, null)).toBeNull();
  });

  it("returns null when maxPoints is zero (guards division by zero)", () => {
    expect(scoreRatioPct(0, 0)).toBeNull();
  });

  it("returns 0 when score is 0 and maxPoints is non-zero", () => {
    expect(scoreRatioPct(0, 5)).toBe(0);
  });

  it("returns 100 for a perfect score", () => {
    expect(scoreRatioPct(5, 5)).toBe(100);
  });
});
