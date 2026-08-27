// shared/domain/exam-queue.ts — the "responder depois" (BR-03) queue rules.
//
// Lives under shared/ (not app/src/shared/lib) since #85: the mobile bundle
// resolves only @shared/@api/@drizzle, so a rule the desktop screens AND the
// mobile runner share cannot live under app/. One home, one definition.
//
// Also the adaptive simulado's "what comes next" rule (`nextAdaptiveStep`),
// which a resumed run replays over its persisted ladder.
//
// Queue helpers for the "responder depois" (postpone) flow in simulations.
// Both helpers are pure: postponing re-orders the pending question queue
// (standard mode) or jumps the cursor to the next unanswered question
// (real exam mode) without ever recording a blank answer.

import {
  nextDifficulty,
  type AdaptiveConfig,
  type AdaptiveState,
  type Difficulty,
} from "./adaptive";

export function moveToEnd<T>(items: readonly T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [...items];
  return [...items.slice(0, index), ...items.slice(index + 1), ...items.slice(index, index + 1)];
}

// Scans indices (from+1 … from+total-1) mod total — deliberately excluding
// `from` itself — and returns the first one not present in `answered`, or
// null when every other question is already answered.
export function findNextUnanswered(
  total: number,
  from: number,
  answered: ReadonlyMap<number, unknown> | ReadonlySet<number>,
): number | null {
  for (let step = 1; step < total; step++) {
    const idx = (from + step) % total;
    if (!answered.has(idx)) return idx;
  }
  return null;
}

/**
 * Seconds already spent on each postponed question, keyed by question id.
 * Treat as immutable. Empty = nothing was ever postponed.
 */
export type CarriedTime = ReadonlyMap<string, number>;

/** Stable empty carry: the starting value for a run. */
export const NO_CARRIED_TIME: CarriedTime = Object.freeze(new Map<string, number>());

/**
 * Bank the `seconds` already spent on `questionId` before it goes to the end of
 * the queue (BR-03.1). Accumulates across repeated postpones; returns a new Map
 * and never mutates the input.
 *
 * Without this the time a student spent reading a question before postponing it
 * is simply lost: the timer restarts when the question comes back, and
 * `user_answers.timeSpent` under-reports every postponed question.
 */
export function carryTime(carried: CarriedTime, questionId: string, seconds: number): CarriedTime {
  const updated = new Map(carried);
  updated.set(questionId, (carried.get(questionId) ?? 0) + seconds);
  return updated;
}

/**
 * The `timeSpent` to record for `questionId`: everything banked by earlier
 * postpones plus the `seconds` of the current visit. Equals `seconds` when the
 * question was never postponed.
 */
export function totalTimeFor(carried: CarriedTime, questionId: string, seconds: number): number {
  return (carried.get(questionId) ?? 0) + seconds;
}

/**
 * Whether the "Responder depois" button should be offered in the Simulado
 * Padrão two-step flow (BR-03): only before the "Conferir" step and while
 * there are more questions in the queue. Lives here, next to `moveToEnd`,
 * because `components/` must not import from `pages/`.
 *
 * The mobile runner reuses it verbatim with `checked` = the instant reveal:
 * there the answer IS checked the moment it is chosen (BR-03.2).
 */
export function canPostponeGuard({
  checked,
  hasMoreQuestions,
}: {
  checked: boolean;
  hasMoreQuestions: boolean;
}): boolean {
  return !checked && hasMoreQuestions;
}

/**
 * Whether "Responder depois" can be offered in the Simulado Adaptativo.
 *
 * The adaptive mode has NO materialized queue — each question is drawn from
 * the pool by difficulty — so "goes to the end of the queue" (BR-03.1) is
 * implemented with an explicit FIFO of deferred questions drained at the tail.
 * Postponing is therefore only offered while the remaining slots still fit the
 * question being deferred PLUS at least one other to answer right now
 * (`>= 2`), so a postpone can never shrink the simulado's answered total.
 * `hasReplacement` is false when the pool has nothing left to draw.
 */
export function canPostponeAdaptive({
  totalAnswered,
  totalQuestions,
  deferredCount,
  hasReplacement,
}: {
  totalAnswered: number;
  totalQuestions: number;
  deferredCount: number;
  hasReplacement: boolean;
}): boolean {
  return hasReplacement && totalQuestions - totalAnswered - deferredCount >= 2;
}

/**
 * Whether the next adaptive question must come from the deferred FIFO instead
 * of a fresh draw from the pool. Serving the head of the FIFO at the tail of
 * the simulado is what guarantees every postponed question comes BACK — a
 * naive postpone would leave it in `questions`, where `fetchQuestion` treats
 * it as already seen and it silently disappears (the opposite of BR-03.1).
 */
export function shouldServeDeferred({
  totalAnswered,
  totalQuestions,
  deferredCount,
  poolExhausted,
}: {
  totalAnswered: number;
  totalQuestions: number;
  deferredCount: number;
  poolExhausted: boolean;
}): boolean {
  if (deferredCount <= 0) return false;
  return poolExhausted || totalQuestions - totalAnswered <= deferredCount;
}

/** What the adaptive simulado does after an answer. */
export type AdaptiveStep =
  | { kind: "finish" }
  /** Serve the head of the deferred FIFO, at its own difficulty. */
  | { kind: "deferred" }
  /** Draw an unseen question, preferring `difficulty`. */
  | { kind: "draw"; difficulty: Difficulty };

/**
 * The whole "what comes next" decision of the Simulado Adaptativo, as one pure
 * function over the LADDER and the queue counters (epic #67 S2c).
 *
 * Pure on purpose: a resumed run feeds it the persisted `AdaptiveState`, so the
 * step it answers is the step the uninterrupted run would have taken — the
 * ladder never restarts at `medium` just because the student left. The caller
 * still owns the draw itself (`fetchQuestion` can come back empty, and then the
 * FIFO is what is left).
 */
export function nextAdaptiveStep({
  adaptive,
  totalQuestions,
  deferredCount,
  poolExhausted,
  config,
}: {
  adaptive: AdaptiveState;
  totalQuestions: number;
  deferredCount: number;
  poolExhausted: boolean;
  config?: AdaptiveConfig;
}): AdaptiveStep {
  if (adaptive.totalAnswered >= totalQuestions) return { kind: "finish" };
  const drain = shouldServeDeferred({
    totalAnswered: adaptive.totalAnswered,
    totalQuestions,
    deferredCount,
    poolExhausted,
  });
  if (drain) return { kind: "deferred" };
  return {
    kind: "draw",
    difficulty: nextDifficulty(
      adaptive.currentDifficulty,
      adaptive.consecutiveCorrect,
      adaptive.consecutiveWrong,
      config,
    ),
  };
}
