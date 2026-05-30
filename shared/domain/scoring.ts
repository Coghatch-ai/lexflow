// shared/domain/scoring.ts
//
// Pure scoring helpers shared by the API and the UI. Business rules like these
// must NOT be re-implemented inline in routers or components — import them here.

/** Percent of correct answers, rounded. 0 when nothing answered. */
export function accuracyPct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/** Goal progress (current accuracy vs target), capped at 100. 0 when no target. */
export function goalProgressPct(currentAccuracy: number, targetAccuracy: number): number {
  return targetAccuracy > 0
    ? Math.min(100, Math.round((currentAccuracy / targetAccuracy) * 100))
    : 0;
}
