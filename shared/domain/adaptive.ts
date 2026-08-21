// shared/domain/adaptive.ts
//
// Adaptive-difficulty algorithm — config-driven so thresholds/levels can change
// without touching call sites. Used by the Adaptive simulation flow.

export type Difficulty = "easy" | "medium" | "hard";

export type AdaptiveConfig = {
  /** Difficulty ladder, easiest → hardest. */
  order: readonly Difficulty[];
  /** Consecutive correct answers needed to step up. */
  stepUpAfter: number;
  /** Consecutive wrong answers needed to step down. */
  stepDownAfter: number;
  /** Where a run starts. */
  startDifficulty: Difficulty;
};

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  order: ["easy", "medium", "hard"],
  stepUpAfter: 2,
  stepDownAfter: 2,
  startDifficulty: "medium",
};

/**
 * The adaptive ladder's live state. Canonical HERE (not in the screen module)
 * so `exam_drafts.mode_state` can persist it verbatim and the API can read it
 * back: `tsconfig.api.json` compiles api/ + drizzle/ + shared/ + scripts/ only,
 * never `app/src/`. `adaptive-screens.tsx` re-exports it, so the screens'
 * import path is unchanged.
 */
export interface AdaptiveState {
  currentDifficulty: Difficulty;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalCorrect: number;
  totalAnswered: number;
  difficultyHistory: Difficulty[];
}

/** Next difficulty given the current streaks. Never steps past the ends. */
export function nextDifficulty(
  current: Difficulty,
  consecutiveCorrect: number,
  consecutiveWrong: number,
  config: AdaptiveConfig = DEFAULT_ADAPTIVE_CONFIG,
): Difficulty {
  const idx = config.order.indexOf(current);
  if (idx === -1) return current;
  if (consecutiveCorrect >= config.stepUpAfter && idx < config.order.length - 1) {
    return config.order[idx + 1] ?? current;
  }
  if (consecutiveWrong >= config.stepDownAfter && idx > 0) {
    return config.order[idx - 1] ?? current;
  }
  return current;
}
