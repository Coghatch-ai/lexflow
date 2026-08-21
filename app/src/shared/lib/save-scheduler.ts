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
  /** Stop for good — no further send happens, whatever is scheduled. */
  close: () => void;
}

export interface SaveSchedulerOptions<T> {
  /** Writes the CURRENT state and resolves with the new token. */
  send: () => Promise<T>;
  delayMs?: number;
  /** Called once per failed send, including the ones nobody is awaiting. */
  onError?: (error: unknown) => void;
}

export function createSaveScheduler<T>({
  send,
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

  const run = (): Promise<T> => {
    dirty = false;
    const attempt = (async (): Promise<T> => {
      try {
        const value = await send();
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

    close: (): void => {
      closed = true;
      dirty = false;
      clearPending();
    },
  };
}
