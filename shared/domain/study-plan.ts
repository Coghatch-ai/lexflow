// shared/domain/study-plan.ts
//
// Domain types and pure functions for the Study Plan feature.

export type PlanConfig = {
  disciplines: string[];
  examBoard: string | null;
  phase: string | null;
  year: number | null;
};

export const DEADLINE_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export type DeadlineDays = (typeof DEADLINE_OPTIONS)[number];

export function questionsPerDayCalc(available: number, deadlineDays: number): number {
  return Math.max(1, Math.ceil(available / deadlineDays));
}

export function planProgressPct(answered: number, perDay: number, elapsed: number): number {
  if (perDay <= 0 || elapsed <= 0) return 0;
  return Math.min(100, Math.round((answered / (perDay * elapsed)) * 100));
}

export function weakestDisciplines(
  stats: ReadonlyArray<{ discipline: string; totalAnswered: number; accuracy: number }>,
  minAnswered: number,
  topN: number,
): string[] {
  return stats
    .filter((s) => s.totalAnswered >= minAnswered)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, topN)
    .map((s) => s.discipline);
}
