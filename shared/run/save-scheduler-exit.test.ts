import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SAVE_DEBOUNCE_MS, WRITE_TIMEOUT_MS, createSaveScheduler } from "./save-scheduler";

// The two ways a run's LAST write can go missing (Codex adversarial review of
// #79) — its own file because `save-scheduler.test.ts` is at its `max-lines`
// budget, and because both describe the same subject: what happens when nobody
// is left to retry. A stalled write that never frees its slot, and the write
// owed at `pagehide`.

/** A write that answers NEITHER way — a stalled connection, not a failed one. */
function hung<T>(): Promise<T> {
  return new Promise<T>(() => {
    // never resolves, never rejects
  });
}

/** A promise the test resolves by hand — stands in for a save still in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// The Codex ADVERSARIAL finding: `fetch` never times out on its own, so ONE
// stalled save or touch held `inFlight` forever — and `beat` skips on exactly
// that slot. The 60 s heartbeat then went silent for the rest of the exam,
// `last_saved_at` aged past REAL_RUN_STALE_SECONDS (180), and the next
// authenticated contact settled the prova real under a student still sitting
// it. Same failure class as the `dirty` round before it, through the other flag.
describe("createSaveScheduler — a write that never answers", () => {
  it("frees the heartbeat instead of silencing it for the rest of the exam", async () => {
    let sends = 0;
    let beats = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return sends === 1 ? hung<string>() : Promise.resolve("token-2");
      },
      keepAlive: () => {
        beats += 1;
        return Promise.resolve("beaten");
      },
      onError: () => undefined,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(sends).toBe(1);

    // While the write is genuinely in the air, skipping is RIGHT — that write
    // refreshes `last_saved_at` itself.
    await scheduler.beat();
    expect(sends).toBe(1);
    expect(beats).toBe(0);

    // Past the bound it is a FAILED write: the slot frees, the payload is owed
    // again, and the next beat resends it. Before the fix every beat from here
    // to the end of the exam did nothing at all.
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    await scheduler.beat();
    expect(sends).toBe(2);
  });

  it("never goes silent while the connection keeps stalling — every beat writes", async () => {
    // The mutation roster: five minutes of hung writes must be five contacts,
    // not zero. A bound that only frees the FIRST slot fails this.
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return hung<string>();
      },
      keepAlive: () => Promise.resolve("beaten"),
      onError: () => undefined,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(sends).toBe(1);

    // Five minutes of beats over a connection that stalls every time. The first
    // is rightly skipped (the initial write is still inside its bound); every
    // one after it resends the owed payload.
    for (let i = 0; i < 5; i += 1) {
      const beating = scheduler.beat();
      await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
      await beating;
    }

    expect(sends).toBe(5);
  });

  it("does not queue the next write behind a touch that stalled", async () => {
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return Promise.resolve("token-1");
      },
      keepAlive: () => hung<string>(),
      onError: () => undefined,
    });

    const beating = scheduler.beat();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    // Correctly queued behind the beat: both write the same token.
    expect(sends).toBe(0);

    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    await beating;
    expect(sends).toBe(1);
  });

  it("answers a flush that is waiting on a stalled write, instead of hanging with it", async () => {
    const scheduler = createSaveScheduler({
      send: () => hung<string>(),
      onError: () => undefined,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const flushed = scheduler.flush();
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS * 2);

    // `ok: false`, which is what the deadline door turns into `hold` — never a
    // promise the caller waits on forever.
    expect((await flushed).ok).toBe(false);
  });
});

// The abrupt exit (`pagehide`), and the Codex adversarial finding on it: the
// handler used to call `flush()`, which AWAITS the network. After an unload
// handler returns, nothing awaiting the network resumes — so the write it owed
// was frequently never issued at all, and the Simulado Real cannot be re-entered.
describe("createSaveScheduler — flushOnExit", () => {
  it("issues the owed write SYNCHRONOUSLY, over the exit transport", () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.resolve("token-exit");
      },
    });

    scheduler.schedule();
    scheduler.flushOnExit();

    // Deliberately NOT awaited: the assertion is that the request left inside
    // the handler's own task. `flush()` here left `writes` empty.
    expect(writes).toEqual(["exit"]);
  });

  it("sends NOTHING when the last write already landed", async () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.resolve("token-exit");
      },
    });

    // Nothing at all has happened yet.
    scheduler.flushOnExit();
    expect(writes).toEqual([]);

    // …and after a save that landed, a tab-switch is not another write. On
    // mobile `visibilitychange` fires on every app switch.
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    scheduler.flushOnExit();
    expect(writes).toEqual(["send"]);
  });

  it("never overtakes a write already in flight — that one owns the token", async () => {
    const flight = deferred<string>();
    const writes: string[] = [];
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        writes.push("send");
        return sends === 1 ? flight.promise : Promise.resolve("token-2");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.resolve("token-exit");
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    // The student answers once more, then closes the tab.
    scheduler.schedule();
    scheduler.flushOnExit();

    // No exit write races the flight: both carry the same optimistic token, and
    // the loser matches 0 rows — a CONFLICT is TERMINAL for the prova real.
    expect(writes).toEqual(["send"]);

    flight.resolve("token-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(["send", "send"]);
  });
});

// The rest of the exit contract, in its own block so neither exceeds
// `max-lines-per-function`: what the exit write cancels, what it owes back when
// it fails, and what it refuses to do.
describe("createSaveScheduler — flushOnExit, cancellation and fallbacks", () => {
  it("cancels the debounce — the exit write is the LAST one, not one of two", async () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.resolve("token-exit");
      },
    });

    scheduler.schedule();
    scheduler.flushOnExit();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);

    expect(writes).toEqual(["exit"]);
  });

  it("keeps the payload owed when the exit write FAILS, for a tab that survives", async () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.reject(new Error("offline"));
      },
      onError: () => undefined,
    });

    scheduler.schedule();
    scheduler.flushOnExit();
    await vi.advanceTimersByTimeAsync(0);

    // A hidden tab that comes back must not believe that write landed: the
    // owed payload is re-armed exactly as a failed `send` is.
    expect(await scheduler.flush()).toEqual({ ok: true, value: "token-send" });
    expect(writes).toEqual(["exit", "send"]);
  });

  it("stays best-effort without an exitSend (every screen that has no keepalive path)", async () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
    });

    scheduler.schedule();
    scheduler.flushOnExit();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(["send"]);
  });

  it("writes nothing after close() — the run already left this tab", () => {
    const writes: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => {
        writes.push("send");
        return Promise.resolve("token-send");
      },
      exitSend: () => {
        writes.push("exit");
        return Promise.resolve("token-exit");
      },
    });

    scheduler.schedule();
    scheduler.close();
    scheduler.flushOnExit();
    expect(writes).toEqual([]);
  });
});
