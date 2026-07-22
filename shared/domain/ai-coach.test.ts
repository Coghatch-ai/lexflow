import { describe, expect, it } from "vitest";
import { buildCoachVariables, parseCoachResponse, type CoachStudentData } from "./ai-coach";

const data: CoachStudentData = {
  totalAnswered: 120,
  totalCorrect: 66,
  accuracy: 55,
  averageTimePerQuestion: 48,
  disciplines: [
    { discipline: "ETHICS", label: "Ética Profissional", totalAnswered: 40, accuracy: 48 },
    { discipline: "CIVIL_LAW", label: "Direito Civil", totalAnswered: 30, accuracy: 70 },
  ],
  timeBuckets: [
    { bucket: "fast", total: 50, errors: 30 },
    { bucket: "slow", total: 20, errors: 5 },
  ],
  recurringErrorCount: 6,
  recurringErrorDisciplines: ["Ética Profissional"],
  dueForReview: 12,
  daysToExam: 40,
};

describe("buildCoachVariables", () => {
  it("serializes the aggregates as one JSON blob", () => {
    const vars = buildCoachVariables(data);
    const parsed = JSON.parse(vars["studentData"] ?? "") as CoachStudentData;
    expect(parsed.accuracy).toBe(55);
    expect(parsed.disciplines[0]?.label).toBe("Ética Profissional");
    expect(parsed.daysToExam).toBe(40);
  });
});

describe("parseCoachResponse", () => {
  const valid = {
    diagnosis: "Você erra rápido demais em Ética.",
    priorities: [
      { discipline: "Ética Profissional", reason: "48% em 40 questões", severity: "alta" },
    ],
    actions: [{ title: "10 questões de Ética por dia", detail: "Leia o enunciado até o fim." }],
  };

  it("parses a clean digest", () => {
    expect(parseCoachResponse(JSON.stringify(valid))).toEqual(valid);
  });

  it("tolerates code fences and stray prose", () => {
    const text = `Segue a análise:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(parseCoachResponse(text)).toEqual(valid);
  });

  it("rejects invalid severity and missing fields", () => {
    const badSeverity = {
      ...valid,
      priorities: [{ discipline: "X", reason: "y", severity: "urgente" }],
    };
    expect(parseCoachResponse(JSON.stringify(badSeverity))).toBeNull();
    expect(parseCoachResponse('{"diagnosis":"só isso"}')).toBeNull();
    expect(parseCoachResponse("sem json")).toBeNull();
  });
});
