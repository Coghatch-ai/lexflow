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

// Minimum number of answered questions before a discipline is eligible for the
// weakest-discipline recommendation. Discursive (2nd-phase) data is sparse
// (typically 1 peça + 4 discursivas per prova), so it uses a lower floor.
export const MIN_ANSWERED_1ST = 5;
export const MIN_ANSWERED_2ND = 2;

export function questionsPerDayCalc(available: number, deadlineDays: number): number {
  return Math.max(1, Math.ceil(available / deadlineDays));
}

export function planProgressPct(answered: number, perDay: number, elapsed: number): number {
  if (perDay <= 0 || elapsed <= 0) return 0;
  return Math.min(100, Math.round((answered / (perDay * elapsed)) * 100));
}

/**
 * Compute the score ratio (0–100) from a raw score and a max-points value.
 * Returns null when either value is absent or maxPoints is zero — the caller
 * must exclude null rows from averages rather than treating them as 0%.
 */
export function scoreRatioPct(
  score: number | null | undefined,
  maxPoints: number | null | undefined,
): number | null {
  if (score == null || maxPoints == null || maxPoints === 0) return null;
  return Math.round((score / maxPoints) * 100);
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
