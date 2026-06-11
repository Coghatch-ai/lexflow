// app/src/shared/lib/shuffle.ts
//
// Display-order shuffle for quiz answer options. Grading and persistence are
// keyed by the full option text (order-independent), so shuffling here only
// affects presentation — the option's index in the stored catalog array (its
// "internal" letter, matching the original exam) is untouched.

export type Rng = () => number; // uniform in [0, 1), Math.random-compatible

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
