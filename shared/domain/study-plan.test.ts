import { describe, expect, it } from "vitest";
import { questionsPerDayCalc, planProgressPct, weakestDisciplines } from "./study-plan";

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
});
