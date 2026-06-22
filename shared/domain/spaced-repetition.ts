// shared/domain/spaced-repetition.ts
//
// SM-2 spaced-repetition algorithm. Config is stored in spaced_repetition_config
// (DB) and editable by admins. DEFAULT_SM2_CONFIG is the fallback when no DB row
// exists yet.

export const DEFAULT_REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/** Legacy ladder-based interval (kept for reference; SM-2 is now used instead). */
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

// ── SM-2 ─────────────────────────────────────────────────────────────────────

export type Sm2Config = {
  defaultEaseFactor: number; // starting EF for new questions (default 2.5)
  minEaseFactor: number; // floor for EF (default 1.3)
  easeFactorCorrectBonus: number; // EF += this on correct (default 0.1)
  easeFactorWrongPenalty: number; // EF -= this on wrong (default 0.2)
  initialInterval: number; // days after 1st success (default 1)
  secondInterval: number; // days after 2nd success (default 6)
};

export type Sm2State = {
  interval: number; // current interval in days
  repetitions: number; // consecutive successful reviews
  easeFactor: number; // EF multiplier
};

export const DEFAULT_SM2_CONFIG: Sm2Config = {
  defaultEaseFactor: 2.5,
  minEaseFactor: 1.3,
  easeFactorCorrectBonus: 0.1,
  easeFactorWrongPenalty: 0.2,
  initialInterval: 1,
  secondInterval: 6,
};

export const DEFAULT_SM2_STATE: Sm2State = {
  interval: 1,
  repetitions: 0,
  easeFactor: DEFAULT_SM2_CONFIG.defaultEaseFactor,
};

/**
 * Apply one SM-2 answer cycle. Returns updated state + the timestamp when the
 * question should next appear. Does NOT mutate the input.
 */
export function sm2Update(
  state: Sm2State,
  correct: boolean,
  config: Sm2Config = DEFAULT_SM2_CONFIG,
): Sm2State & { nextReviewAt: Date } {
  let { interval, repetitions, easeFactor } = state;

  let nextReviewAt: Date;

  if (correct) {
    repetitions += 1;
    if (repetitions === 1) {
      interval = config.initialInterval;
    } else if (repetitions === 2) {
      interval = config.secondInterval;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    easeFactor = Math.max(config.minEaseFactor, easeFactor + config.easeFactorCorrectBonus);
    // Correct answer: schedule for midnight on the future review day (next day or later).
    const d = new Date();
    d.setDate(d.getDate() + interval);
    d.setHours(0, 0, 0, 0);
    nextReviewAt = d;
  } else {
    repetitions = 0;
    interval = config.initialInterval;
    easeFactor = Math.max(config.minEaseFactor, easeFactor - config.easeFactorWrongPenalty);
    // Wrong answer: due immediately so it surfaces in the review queue right away.
    nextReviewAt = new Date();
  }

  return { interval, repetitions, easeFactor, nextReviewAt };
}
