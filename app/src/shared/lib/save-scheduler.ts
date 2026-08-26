// app/src/shared/lib/save-scheduler.ts
//
// The save CADENCE of a run being persisted server-side (BR-05, epic #67 slice
// S2b). Pure module: no React, no tRPC, no timers of its own beyond
// `setTimeout` — the whole cadence is provable with `vi.useFakeTimers()` and no
// jsdom, which is why it does not live inside the hook that uses it.
//
// Trailing debounce, never leading: answers confirmed in quick succession
// coalesce into ONE write, and the write carries the newest payload rather than
// the oldest. `send` is a closure over whatever the screen holds right now, so
// the scheduler never stores a payload and can never send a stale one.
//
// `flush()` is the exit path and the reason this module exists at all. It must
// resolve with the FINAL token: the caller hands that token to
// `sessions.record` as the draft claim, which is matched with `=` against
// `last_saved_at`. Resolving while a save is still in the air would hand over
// the token from BEFORE that save, the claim would match 0 rows, and the
// student would get a CONFLICT caused by their own save (api/lib/record-session.ts).

/** Debounce window between a confirmed answer and its write (BR-05 S2b). */
export const SAVE_DEBOUNCE_MS = 1500;

/**
 * The outcome of a flush. Never a rejected promise: an exit handler awaits
 * this before deciding whether to record/navigate, and a throw there is how a
 * CONFLICT turns into a blank screen instead of a dialog.
 */
export type FlushResult<T> = { ok: true; value: T | null } | { ok: false; error: unknown };

export interface SaveScheduler<T> {
  /** An answer was confirmed: (re)arm the trailing debounce. */
  schedule: () => void;
  /** Land everything pending and resolve with the FINAL result. */
  flush: () => Promise<FlushResult<T>>;
  /**
   * The prova real's 60 s heartbeat (BR-05.5, slice S2d): tell the server this
   * tab is still alive WITHOUT rewriting the ~25 KB of jsonb a `save` carries.
   *
   * It goes through the scheduler instead of a loose `setInterval` because
   * `keepAlive` and `send` write the SAME optimistic token (`last_saved_at`),
   * and two writers on one token is a false CONFLICT waiting to happen — one
   * that STOPS the autosave for good (`raiseIfConflict` closes the scheduler),
   * leaving the exam alive only in the tab. Two rules keep them apart:
   *   - skipped whenever a save is scheduled, in flight or pending (`dirty`) —
   *     a save already refreshes `last_saved_at`, so it IS a heartbeat;
   *   - dispatched through the same queue as `send`, so a `schedule()` landing
   *     mid-beat is sent AFTER it and reads the token the beat produced.
   * A no-op when no `keepAlive` was given (every study mode).
   */
  beat: () => Promise<void>;
  /** Stop for good — no further send happens, whatever is scheduled. */
  close: () => void;
}

export interface SaveSchedulerOptions<T> {
  /** Writes the CURRENT state and resolves with the new token. */
  send: () => Promise<T>;
  /** Refreshes the token WITHOUT rewriting the payload (`examDrafts.touch`). */
  keepAlive?: () => Promise<T>;
  delayMs?: number;
  /** Called once per failed send, including the ones nobody is awaiting. */
  onError?: (error: unknown) => void;
}

export function createSaveScheduler<T>({
  send,
  keepAlive,
  delayMs = SAVE_DEBOUNCE_MS,
  onError,
}: SaveSchedulerOptions<T>): SaveScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<T> | null = null;
  // Set by `schedule`, cleared when a send STARTS: a schedule that lands
  // during a flight leaves it true, which is what makes `flush` send again.
  let dirty = false;
  let closed = false;
  let last: T | null = null;

  const clearPending = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /**
   * Sends one write, QUEUED behind whatever is already in the air.
   *
   * The chaining is the fix for the token race (slice S2d): `send` and
   * `keepAlive` both move `last_saved_at`, and two overlapping writes read the
   * token from before the other landed, so the second one matches 0 rows and
   * raises a CONFLICT the student never caused. Serialized, every write reads
   * the token its predecessor produced.
   *
   * A failed predecessor is awaited but never rethrown here: it already went to
   * `onError` and it must not cancel the write behind it (a dropped request is
   * retried by the next debounce, not treated as a lost race).
   */
  const dispatch = (write: () => Promise<T>): Promise<T> => {
    const previous = inFlight;
    const attempt = (async (): Promise<T> => {
      if (previous !== null) await previous.catch(() => undefined);
      try {
        const value = await write();
        last = value;
        return value;
      } catch (error: unknown) {
        onError?.(error);
        throw error;
      }
    })();
    inFlight = attempt;
    const settle = (): void => {
      if (inFlight === attempt) inFlight = null;
    };
    // Registers a rejection handler on `attempt` itself, so a background send
    // that fails is reported through `onError` and never becomes an unhandled
    // rejection — while `flush` still sees the failure by awaiting it.
    void attempt.then(settle, settle);
    return attempt;
  };

  const run = (): Promise<T> => {
    dirty = false;
    return dispatch(send);
  };

  return {
    schedule: (): void => {
      if (closed) return;
      dirty = true;
      clearPending();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },

    flush: async (): Promise<FlushResult<T>> => {
      clearPending();
      try {
        // Drain what is already flying (its token is newer than ours)…
        let pending = inFlight;
        while (pending !== null) {
          await pending;
          pending = inFlight;
        }
        // …then, only if the payload moved while it flew, write once more.
        if (dirty && !closed) await run();
        return { ok: true, value: last };
      } catch (error: unknown) {
        return { ok: false, error };
      }
    },

    beat: async (): Promise<void> => {
      const keep = keepAlive;
      if (closed || keep === undefined) return;
      // A save already refreshes `last_saved_at`, so scheduling/flying/dirty
      // all mean "this minute is already accounted for". Skipping is what keeps
      // `touch` and `save` off the same token — remove it and the exam eats a
      // false CONFLICT roughly once an hour.
      if (timer !== null || inFlight !== null || dirty) return;
      try {
        await dispatch(keep);
      } catch {
        // Already reported through `onError`. A failed beat is never fatal on
        // its own: the caller decides what a CONFLICT means, and a blip is
        // covered by the next beat 60 s later.
      }
    },

    close: (): void => {
      closed = true;
      dirty = false;
      clearPending();
    },
  };
}
