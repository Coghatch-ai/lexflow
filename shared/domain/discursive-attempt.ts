// shared/domain/discursive-attempt.ts
//
// Pure helpers for OAB 2ª-fase (discursive) self-evaluation. Business rules like
// the pass threshold and score clamping live here — never re-implement them
// inline in the router or the UI. See also [[discursive-question]] for the
// catalog-side types.

// Minimum total (out of 10) to pass the OAB 2ª fase.
export const PASS_THRESHOLD = 6.0;

// A full prova = 1 peça (5,0) + 4 discursivas (1,25 each).
export const PROVA_MAX_POINTS = 10.0;

/** Clamp a self/AI score into [0, maxPoints], rounded to 2 decimals. */
export function clampScore(score: number, maxPoints: number): number {
  const bounded = Math.min(Math.max(score, 0), maxPoints);
  return Math.round(bounded * 100) / 100;
}

/** Sum per-item scores (null = not yet graded, counts as 0), rounded to 2 decimals. */
export function sumScores(scores: ReadonlyArray<number | null>): number {
  const total = scores.reduce<number>((acc, s) => acc + (s ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Whether a prova total (out of 10) reaches the pass threshold. */
export function isProvaPass(totalScore: number): boolean {
  return totalScore >= PASS_THRESHOLD;
}
