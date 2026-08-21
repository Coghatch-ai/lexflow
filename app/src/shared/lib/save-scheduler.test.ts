import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_DEBOUNCE_MS, createSaveScheduler } from "./save-scheduler";

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

describe("createSaveScheduler — cadence", () => {
  it("coalesces answers confirmed inside the debounce window into ONE send", async () => {
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return Promise.resolve(`t${String(calls)}`);
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(700);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toBe(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toBe(1);
  });

  it("is TRAILING, not leading: nothing goes out before the window closes", async () => {
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return Promise.resolve("t");
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
  });
});

describe("createSaveScheduler — flush, close and failures", () => {
  it("flush sends the pending write immediately and cancels the scheduled one", async () => {
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return Promise.resolve("token-1");
      },
    });

    scheduler.schedule();
    const result = await scheduler.flush();

    expect(result).toEqual({ ok: true, value: "token-1" });
    expect(calls).toBe(1);

    // The debounce that was armed must NOT fire on top of the flush.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(calls).toBe(1);
  });

  it("flush with a send IN FLIGHT waits for it and resolves with ITS token", async () => {
    const flight = deferred<string>();
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return flight.promise;
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toBe(1);

    const flushed = scheduler.flush();
    flight.resolve("token-in-flight");

    // No second send: nothing changed while the first one was flying, so the
    // token it lands with is already the final one.
    expect(await flushed).toEqual({ ok: true, value: "token-in-flight" });
    expect(calls).toBe(1);
  });

  it("flush resends EXACTLY once when the payload moved during the flight, and returns the last token", async () => {
    const first = deferred<string>();
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        if (calls === 1) return first.promise;
        return Promise.resolve(`token-${String(calls)}`);
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toBe(1);

    // The student answers again while the first save is still in the air.
    scheduler.schedule();
    const flushed = scheduler.flush();
    first.resolve("token-1");

    expect(await flushed).toEqual({ ok: true, value: "token-2" });
    expect(calls).toBe(2);
  });

  it("flush on an idle scheduler sends nothing and echoes the last token", async () => {
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return Promise.resolve("token-1");
      },
    });

    expect(await scheduler.flush()).toEqual({ ok: true, value: null });
    expect(calls).toBe(0);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(await scheduler.flush()).toEqual({ ok: true, value: "token-1" });
    expect(calls).toBe(1);
  });

  it("sends nothing after close(), whatever was scheduled", async () => {
    let calls = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        calls += 1;
        return Promise.resolve("token-1");
      },
    });

    scheduler.schedule();
    scheduler.close();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(calls).toBe(0);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(await scheduler.flush()).toEqual({ ok: true, value: null });
    expect(calls).toBe(0);
  });
});

describe("createSaveScheduler — failures", () => {
  it("reports a failed send through onError and answers flush with ok:false", async () => {
    const boom = new Error("CONFLICT");
    const seen: unknown[] = [];
    const scheduler = createSaveScheduler({
      send: () => Promise.reject(boom),
      onError: (error) => {
        seen.push(error);
      },
    });

    scheduler.schedule();
    const result = await scheduler.flush();

    expect(result).toEqual({ ok: false, error: boom });
    expect(seen).toEqual([boom]);
  });

  it("reports a BACKGROUND failure through onError without an unhandled rejection", async () => {
    const boom = new Error("CONFLICT");
    const seen: unknown[] = [];
    const scheduler = createSaveScheduler({
      send: () => Promise.reject(boom),
      onError: (error) => {
        seen.push(error);
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(seen).toEqual([boom]);
  });
});
