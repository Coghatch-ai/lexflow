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
//
// `flushOnExit()` is the OTHER exit — the one nobody waits for, because the tab
// is being destroyed. It is synchronous and issues the owed write through
// `exitSend` (a `keepalive` request), since after an unload handler returns
// nothing that awaits the network ever resumes. Every write here is also
// BOUNDED (`WRITE_TIMEOUT_MS`): silence becomes a failure, so the slot `beat`
// skips on can never be held forever by a request that stalled.

import { UNSETTLED, settleWithin } from "./settle-within";

/** Debounce window between a confirmed answer and its write (BR-05 S2b). */
export const SAVE_DEBOUNCE_MS = 1500;

/**
 * How long ONE write may stay in the air before it counts as failed (Codex
 * adversarial review of #79).
 *
 * `fetch` never times out on its own: a connection that stalls after the
 * request left resolves neither way. The slot such a write occupies
 * (`inFlight`) is what `beat` skips on — so ONE hung save or touch silenced the
 * 60 s heartbeat forever, `last_saved_at` aged past `REAL_RUN_STALE_SECONDS`
 * (180), and the next authenticated contact settled the prova real under a
 * student still sitting it. The same failure the `dirty` re-arm fixed one round
 * earlier, through the other flag.
 *
 * 30 s is chosen against those two numbers: comfortably longer than any healthy
 * write on a bad mobile link, and short enough that the NEXT beat (≤ 60 s away)
 * resends the owed payload well inside the 180 s staleness window. Tripping it
 * early costs one extra write — the retry is idempotent by construction
 * (`saveRun` adopts the row it can prove it wrote) — while not tripping it at
 * all costs the exam.
 */
export const WRITE_TIMEOUT_MS = 30_000;

/** What a write that never answered rejects with. */
export const WRITE_TIMEOUT_MESSAGE = "save timed out";

/**
 * One write, BOUNDED: silence becomes a rejection, which is the single outcome
 * every path here already handles (`onError`, the `dirty` re-arm, `ok: false`).
 *
 * It does not cancel the request — `mutateAsync` exposes no signal — so the
 * loser keeps flying and lands harmlessly: the row is UNIQUE on
 * `(user_id, mode)`, and the resend either carries the right token or raises
 * the honest CONFLICT.
 */
async function boundedWrite<T>(written: Promise<T>, ms: number): Promise<T> {
  const raced = await settleWithin(
    written.then((value) => ({ value })),
    ms,
  );
  if (raced === UNSETTLED) throw new Error(WRITE_TIMEOUT_MESSAGE);
  return raced.value;
}

/**
 * The outcome of a flush. Never a rejected promise: an exit handler awaits
 * this before deciding whether to record/navigate, and a throw there is how a
 * CONFLICT turns into a blank screen instead of a dialog.
 *
 * `ok: true` is a CONTRACT the callers depend on — "everything this scheduler
 * was asked to send has landed on the server", not "no send failed while you
 * were watching". A send that failed in the background is re-armed (`run`) and
 * resent by the flush, so it can only be reported as `ok: true` after it
 * actually lands.
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
   * leaving the exam alive only in the tab. Three rules keep them apart:
   *   - skipped whenever a save is scheduled or in flight — that save already
   *     refreshes `last_saved_at`, so it IS a heartbeat;
   *   - dispatched through the same queue as `send`, so a `schedule()` landing
   *     mid-beat is sent AFTER it and reads the token the beat produced;
   *   - a beat with an OWED write (`dirty` re-armed by a failed send, nothing
   *     scheduled, nothing flying) resends that write instead of touching —
   *     never silence, because silence is what gets the run judged abandoned.
   * A no-op when no `keepAlive` was given (every study mode).
   */
  beat: () => Promise<void>;
  /**
   * The tab is GOING AWAY (`pagehide` / `visibilitychange: hidden`).
   *
   * Two things separate it from `flush()` (Codex adversarial review of #79):
   *
   * 1. the TRANSPORT. A normal request is cancelled with the document, so a
   *    write issued from `pagehide` lands only if it happens to beat the
   *    unload. `exitSend` is a `fetch` with `keepalive: true`, which the
   *    browser finishes after the document is gone.
   * 2. NOTHING is awaited before issuing it. `flush()` drains what is already
   *    flying first, and after an unload handler returns nothing awaiting the
   *    network ever resumes — so in that case the owed write was never issued
   *    at all.
   *
   * Three cases, in order:
   *   - nothing owed → nothing sent. The last write already landed, and a
   *     duplicate save on every tab-switch is a request per app-switch on
   *     mobile.
   *   - owed and the queue is IDLE → `exitSend` is dispatched now. `dispatch`
   *     calls the writer synchronously when nothing precedes it, so the request
   *     leaves inside the unload handler's own task.
   *   - owed but a write is already in FLIGHT → falls back to `flush()`. The
   *     exit write must not overtake it: both carry the same optimistic token,
   *     the loser matches 0 rows, and a CONFLICT is TERMINAL for the prova real
   *     (`raiseIfConflict` closes the scheduler). Queued behind it, the exit
   *     write is best-effort exactly as before — that residual window is real
   *     and documented, not closed.
   */
  flushOnExit: () => void;
  /** Stop for good — no further send happens, whatever is scheduled. */
  close: () => void;
}

export interface SaveSchedulerOptions<T> {
  /** Writes the CURRENT state and resolves with the new token. */
  send: () => Promise<T>;
  /** Refreshes the token WITHOUT rewriting the payload (`examDrafts.touch`). */
  keepAlive?: () => Promise<T>;
  /**
   * Writes the CURRENT state over a transport that survives the document being
   * destroyed (`keepalive`). Same payload as `send`, different plumbing — a
   * no-op distinction everywhere except `flushOnExit`. Absent = the exit stays
   * best-effort through `flush()`.
   */
  exitSend?: () => Promise<T>;
  delayMs?: number;
  /** Called once per failed send, including the ones nobody is awaiting. */
  onError?: (error: unknown) => void;
}

export function createSaveScheduler<T>({
  send,
  keepAlive,
  exitSend,
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
   *
   * With NOTHING in flight the writer is called synchronously (the async body
   * runs to its first real `await`), which is what lets `flushOnExit` issue a
   * request from inside an unload handler.
   */
  const dispatch = (write: () => Promise<T>): Promise<T> => {
    const previous = inFlight;
    const attempt = (async (): Promise<T> => {
      if (previous !== null) await previous.catch(() => undefined);
      try {
        // BOUNDED: a write that never answers must free this slot, or `beat`
        // skips on it for the rest of the exam (`WRITE_TIMEOUT_MS`).
        const value = await boundedWrite(write(), WRITE_TIMEOUT_MS);
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

  /**
   * Sends the current payload, and RE-ARMS `dirty` if that send failed.
   *
   * `dirty` is cleared before the dispatch on purpose (a `schedule()` landing
   * mid-flight must leave it true so `flush` writes again), but a send that
   * REJECTS never wrote the payload either — so clearing it there would forget
   * the write for good. That is the audit finding of #79: a background save
   * that died left nothing pending, and the deadline's `flush()` answered
   * `ok: true` having sent nothing, so `processReal` settled a row that did
   * not exist and the review screen was shown over answers that lived only in
   * the tab. Re-armed, the flush RESENDS and — if that fails too — reports
   * `ok: false`, which is what `deadlineSettlementFor` turns into `hold`.
   *
   * `ok: true` therefore means what every caller already assumes: everything
   * the scheduler was asked to send has landed.
   */
  const run = (write: () => Promise<T> = send): Promise<T> => {
    dirty = false;
    const rearmed = dispatch(write).catch((error: unknown) => {
      dirty = true;
      throw error;
    });
    // `dispatch` only guards ITS promise against an unhandled rejection; this
    // derived one needs its own handler, because the debounce fires it with
    // nobody awaiting (`void run()`).
    void rearmed.catch(() => undefined);
    return rearmed;
  };

  const flush = async (): Promise<FlushResult<T>> => {
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

    flush,

    flushOnExit: (): void => {
      // Nothing owed: the last write landed and the debounce is empty.
      if (closed || (!dirty && timer === null)) return;
      clearPending();
      // A write already in flight owns the token — the exit write queues behind
      // it through `flush`, which is best-effort and may never be issued.
      if (exitSend === undefined || inFlight !== null) {
        void flush();
        return;
      }
      void run(exitSend);
    },

    beat: async (): Promise<void> => {
      const keep = keepAlive;
      if (closed || keep === undefined) return;
      // A save that is SCHEDULED or IN FLIGHT already refreshes `last_saved_at`,
      // so this minute is accounted for. Skipping those two is what keeps
      // `touch` and `save` off the same token — remove it and the exam eats a
      // false CONFLICT roughly once an hour.
      if (timer !== null || inFlight !== null) return;
      try {
        // `dirty` with NOTHING scheduled and NOTHING flying is not "a save is
        // coming": since `run` re-arms it on failure, it means the last send
        // FAILED and nothing will retry it until the student answers again. The
        // old guard skipped on it too, so ONE background blip silenced the 60 s
        // heartbeat for the rest of the exam — `last_saved_at` then aged past
        // REAL_RUN_STALE_SECONDS (180) and the next authenticated contact
        // (`users.me`, `examDrafts.list`) settled the run under a student who
        // was still taking it (audit of #79, criterion 6).
        //
        // Resending is strictly better than beating here: it refreshes the same
        // token a `touch` would AND finally delivers the payload, and it cannot
        // race the beat because `dispatch` serializes every write. `run`
        // re-arms `dirty` again if this attempt fails too, so the next beat
        // retries instead of giving up. Awaited, not fired-and-forgotten, so a
        // beat never outlives the write it started.
        await (dirty ? run() : dispatch(keep));
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
