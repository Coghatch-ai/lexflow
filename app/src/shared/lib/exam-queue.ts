// app/src/shared/lib/exam-queue.ts
//
// Queue helpers for the "responder depois" (postpone) flow in simulations.
// Both helpers are pure: postponing re-orders the pending question queue
// (standard mode) or jumps the cursor to the next unanswered question
// (real exam mode) without ever recording a blank answer.

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
 * Whether the "Responder depois" button should be offered in the Simulado
 * Padrão two-step flow (BR-03): only before the "Conferir" step and while
 * there are more questions in the queue. Lives here, next to `moveToEnd`,
 * because `components/` must not import from `pages/`.
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
