// shared/domain/spaced-repetition.ts
//
// Spaced-repetition interval schedule — config-driven. Used by the Spaced
// Repetition review flow.

export const DEFAULT_REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/** Next review interval: advance one step on correct, reset to first on wrong. */
export function nextReviewIntervalDays(
  currentIntervalDays: number,
  correct: boolean,
  intervals: readonly number[] = DEFAULT_REVIEW_INTERVALS_DAYS,
): number {
  if (intervals.length === 0) return currentIntervalDays;
  const first = intervals[0] ?? currentIntervalDays;
  if (!correct) return first;
  const idx = intervals.indexOf(currentIntervalDays);
  const nextIdx = Math.min(idx + 1, intervals.length - 1);
  return intervals[nextIdx] ?? first;
}
