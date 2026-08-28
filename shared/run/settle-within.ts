// A bound on ONE awaited call, so a request that never answers becomes an
// ANSWER the caller can act on (third audit round of #79).
//
// The bug this exists for: a screen that renders "waiting" while awaiting a
// promise asserts the wait will END. `fetch` makes no such promise — a stalled
// connection resolves neither way, and `httpBatchLink` passes no signal — so
// the deadline auto-submit of the Simulado Real could hold a student on the
// actionless `submitting` card forever, never reaching the retry behind it.
//
// Deliberately NOT a global bound (a fetch-level `AbortSignal.timeout` on the
// tRPC client): `ai.grade` and the tutor stream legitimately run longer than
// any bound short enough to help here, and every other screen keeps a button
// the student can press. The bound belongs to the ONE door that has neither.
//
// It does not cancel the call — `mutateAsync` exposes no signal to abort with.
// The losing promise keeps flying and, if it lands, lands harmlessly: the
// deadline retry re-flushes (`saveRun` adopts the row it can prove it wrote)
// and `processReal` settles at most once. What the bound buys is the VERDICT,
// which is what puts a button back on the screen.
//
// Pure and React-free: the whole rule is provable with `vi.useFakeTimers()`.

/** The promise did not answer within the bound. */
export const UNSETTLED = "unsettled";

/** A value, or the marker that it never arrived. */
export type Settled<T> = T | typeof UNSETTLED;

/**
 * Resolve with the promise's value, or with `UNSETTLED` once `ms` have passed —
 * whichever happens first. A REJECTION still propagates, so a `try`/`catch`
 * around the call keeps working unchanged; only the silence is converted.
 *
 * `T extends object` so the marker can never collide with a legitimate value.
 */
export async function settleWithin<T extends object>(
  promise: Promise<T>,
  ms: number,
): Promise<Settled<T>> {
  const bound = boundAfter(ms);
  try {
    // `race` attaches its own handlers to BOTH sides, so a late rejection from
    // the loser is already handled and never becomes an unhandled rejection.
    return await Promise.race([promise, bound.promise]);
  } finally {
    // Always — a bound whose timer outlives the call it bounded is a leak, and
    // under fake timers it is a test that never drains.
    bound.cancel();
  }
}

/** What a call that never answered rejects with. */
export const TIMED_OUT_MESSAGE = "save timed out";

/**
 * `settleWithin` as a REJECTION instead of a marker: one awaited call, bounded,
 * where silence becomes the single outcome every save path already handles
 * (`onError`, the `dirty` re-arm, `saveRun`'s claimless recovery, `ok: false`).
 *
 * It lives here rather than in either caller because both need the very same
 * bound for opposite reasons — `save-scheduler` to free the slot `beat` skips
 * on, `run-claimless` to turn a hung write into the lost-response case it
 * already knows how to recover from — and two copies of one bound is how the
 * two budgets drift out of the order they depend on.
 *
 * It does NOT cancel the call (`mutateAsync` exposes no signal): the loser keeps
 * flying and may still commit. That is precisely why the caller that owns the
 * payload must be the one to bound it — see `saveRun`.
 */
export async function boundedCall<T>(call: Promise<T>, ms: number): Promise<T> {
  // Wrapped in an object because `settleWithin` takes `T extends object`, which
  // is what keeps `UNSETTLED` from colliding with a legitimate string value.
  const raced = await settleWithin(
    call.then((value) => ({ value })),
    ms,
  );
  if (raced === UNSETTLED) throw new Error(TIMED_OUT_MESSAGE);
  return raced.value;
}

/** The bound as a promise plus its off switch, so the handle never escapes. */
function boundAfter(ms: number): { promise: Promise<typeof UNSETTLED>; cancel: () => void } {
  let cancel = (): void => undefined;
  const promise = new Promise<typeof UNSETTLED>((resolve) => {
    const timer = setTimeout(() => {
      resolve(UNSETTLED);
    }, ms);
    cancel = (): void => {
      clearTimeout(timer);
    };
  });
  return { promise, cancel };
}
