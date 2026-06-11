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
