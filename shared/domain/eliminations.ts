// Session-only "cross out an alternative" state (BR-02) for the answering
// screens. Pure module: no React, no persistence, no tRPC — a cross-out never
// reaches the sessions.record payload, the grade, the stats or SM-2.
//
// Lives under shared/ (not app/src/shared/lib) since #85: the mobile bundle
// resolves only @shared/@api/@drizzle, so the desktop `QuestionCard` screens and
// the mobile `QuestionRunner` share this one definition instead of two copies.
//
// The state is a Map keyed by question id holding the eliminated option texts.
// A Map (not a Record) because a Record index is only as honest as the tsconfig
// reading it: this file is now checked by tsconfig.api.json (max-strict) AND
// consumed by the two frontend programs, which run without
// `noUncheckedIndexedAccess` — there the index would lie about its type.

/** Eliminated option texts per question id. Treat as immutable. */
export type EliminationState = ReadonlyMap<string, readonly string[]>;

/** Stable empty list — returned by `eliminatedFor` so the prop identity never changes. */
const NONE: readonly string[] = Object.freeze([]);

/**
 * Stable empty state: the starting value for a simulado. Frozen so the module
 * constant cannot grow properties; the `ReadonlyMap` type is what keeps `.set`
 * out (`Object.freeze` does not seal a Map's internal entries).
 */
export const NO_ELIMINATIONS: EliminationState = Object.freeze(
  new Map<string, readonly string[]>(),
);

/**
 * The options crossed out for `questionId`. Always the same empty reference
 * when there are none, so passing it as a prop does not re-render the row.
 */
export function eliminatedFor(state: EliminationState, questionId: string): readonly string[] {
  return state.get(questionId) ?? NONE;
}

/** Whether `option` is crossed out for `questionId`. */
export function isEliminated(state: EliminationState, questionId: string, option: string): boolean {
  return eliminatedFor(state, questionId).includes(option);
}

/**
 * Cross out `option` for `questionId`, or restore it when already crossed out.
 * Returns a new state; the input is never mutated.
 */
export function toggleElimination(
  state: EliminationState,
  questionId: string,
  option: string,
): EliminationState {
  const current = eliminatedFor(state, questionId);
  const next = current.includes(option)
    ? current.filter((o) => o !== option)
    : [...current, option];

  const updated = new Map(state);
  if (next.length === 0) {
    updated.delete(questionId);
  } else {
    updated.set(questionId, next);
  }
  return updated;
}

/**
 * Drop every cross-out of `questionId` (its answer was recorded). Returns the
 * same reference when there is nothing to clear.
 */
export function clearForQuestion(state: EliminationState, questionId: string): EliminationState {
  if (!state.has(questionId)) return state;
  const updated = new Map(state);
  updated.delete(questionId);
  return updated;
}

/**
 * Whether a touch drag of `dx`/`dy` pixels is a cross-out swipe: far enough
 * sideways AND more horizontal than vertical, so vertical page scroll is never
 * hijacked.
 */
export function isEliminationSwipe(dx: number, dy: number, threshold = 60): boolean {
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy);
}

/**
 * Per-row touch latch. `origin` is the start of the in-flight drag;
 * `swallowClick` marks that the LAST gesture was a cross-out swipe, whose
 * trailing synthetic click must not select the option.
 *
 * The rules live here (not inside the card) so they are unit-testable without
 * jsdom/RTL: the component only stores the value in a ref.
 */
export type SwipeLatch = Readonly<{
  origin: Readonly<{ x: number; y: number }> | null;
  swallowClick: boolean;
}>;

/** Neutral latch: no drag in flight, nothing to swallow. */
export const IDLE_SWIPE: SwipeLatch = Object.freeze({ origin: null, swallowClick: false });

/**
 * Start a touch sequence. Always returns a DISARMED latch: a cross-out swipe
 * clears touch slop, so Chrome/Android cancels the tap and the trailing click
 * never arrives — carrying `swallowClick` over would eat the next real tap on
 * that row (and, with a reused row instance, on the next question).
 */
export function startSwipe(x: number, y: number): SwipeLatch {
  return { origin: { x, y }, swallowClick: false };
}

/**
 * End a touch sequence. `crossOut` tells the caller to toggle the option; the
 * returned latch swallows the synthetic click only when the drag was a swipe.
 */
export function endSwipe(
  latch: SwipeLatch,
  x: number,
  y: number,
  threshold = 60,
): Readonly<{ latch: SwipeLatch; crossOut: boolean }> {
  const origin = latch.origin;
  if (origin === null) return { latch, crossOut: false };
  const crossOut = isEliminationSwipe(x - origin.x, y - origin.y, threshold);
  return { latch: { origin: null, swallowClick: crossOut }, crossOut };
}

/**
 * Consume a click. `selects` is false exactly once after a cross-out swipe;
 * every later click on that row selects normally.
 */
export function consumeClick(latch: SwipeLatch): Readonly<{ latch: SwipeLatch; selects: boolean }> {
  if (!latch.swallowClick) return { latch, selects: true };
  return { latch: { origin: latch.origin, swallowClick: false }, selects: false };
}

/**
 * Whether crossing out `option` must drop the answer already selected
 * (BR-02.2): a crossed-out alternative can no longer be the chosen one.
 * The rule lives here so the four answering screens share one definition
 * instead of each re-writing `selectedAnswer === option` inline.
 */
export function eliminationDropsAnswer(selectedAnswer: string, option: string): boolean {
  return selectedAnswer.length > 0 && selectedAnswer === option;
}
