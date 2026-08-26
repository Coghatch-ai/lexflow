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

// The prova real's 60 s heartbeat (epic #67 slice S2d, #79). `keepAlive`
// (`examDrafts.touch`) and `send` (`examDrafts.save`) write the SAME optimistic
// token, so the whole point of these tests is that they never overlap and never
// run when the other already did the job.
describe("createSaveScheduler — beat (the prova real heartbeat)", () => {
  it("sends keepAlive when the scheduler is idle", async () => {
    const beats: string[] = [];
    const scheduler = createSaveScheduler({
      send: () => Promise.resolve("saved"),
      keepAlive: () => {
        beats.push("beat");
        return Promise.resolve("beaten");
      },
    });

    await scheduler.beat();

    expect(beats).toEqual(["beat"]);
    expect(await scheduler.flush()).toEqual({ ok: true, value: "beaten" });
  });

  it("is SKIPPED while a save is scheduled — that save is already the heartbeat", async () => {
    let beats = 0;
    let saves = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        saves += 1;
        return Promise.resolve("saved");
      },
      keepAlive: () => {
        beats += 1;
        return Promise.resolve("beaten");
      },
    });

    scheduler.schedule();
    await scheduler.beat();

    expect(beats).toBe(0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saves).toBe(1);
  });

  it("is SKIPPED while a save is IN FLIGHT", async () => {
    const flight = deferred<string>();
    let beats = 0;
    const scheduler = createSaveScheduler({
      send: () => flight.promise,
      keepAlive: () => {
        beats += 1;
        return Promise.resolve("beaten");
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await scheduler.beat();
    expect(beats).toBe(0);

    flight.resolve("token-1");
    expect(await scheduler.flush()).toEqual({ ok: true, value: "token-1" });
    expect(beats).toBe(0);
  });

  it("never beats across an open flush — the exit's own resend owns the token", async () => {
    // `dirty` is the third guard, and this is the window it covers: a flush has
    // already cancelled the debounce (`timer` null) and is draining the flight
    // before writing once more. A beat slipping in there would take the token
    // the owed resend is about to claim with.
    const flight = deferred<string>();
    let beats = 0;
    let saves = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        saves += 1;
        return saves === 1 ? flight.promise : Promise.resolve("token-2");
      },
      keepAlive: () => {
        beats += 1;
        return Promise.resolve("beaten");
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    // The student answers again while the first save is still in the air.
    scheduler.schedule();
    const flushed = scheduler.flush();
    const beating = scheduler.beat();
    flight.resolve("token-1");

    await beating;
    expect(beats).toBe(0);
    expect(await flushed).toEqual({ ok: true, value: "token-2" });
    expect(saves).toBe(2);
  });

  it("does nothing at all without a keepAlive (every study mode)", async () => {
    const study = createSaveScheduler({ send: () => Promise.resolve("saved") });
    await study.beat();
    expect(await study.flush()).toEqual({ ok: true, value: null });
  });
});

describe("createSaveScheduler — beat serialization", () => {
  it("SERIALIZES a schedule() that lands during a beat, and flush returns the LAST token", async () => {
    // The mutation this kills: drop the skip/serialization and the save goes
    // out holding the token from BEFORE the beat — a CONFLICT the student never
    // caused, which stops the autosave for the rest of the exam.
    const order: string[] = [];
    const beat = deferred<string>();
    const scheduler = createSaveScheduler({
      send: () => {
        order.push("save");
        return Promise.resolve("token-from-save");
      },
      keepAlive: () => {
        order.push("beat");
        return beat.promise;
      },
    });

    const beating = scheduler.beat();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    // The save has NOT gone out: it is queued behind the beat still in the air.
    expect(order).toEqual(["beat"]);

    beat.resolve("token-from-beat");
    await beating;
    const flushed = await scheduler.flush();

    expect(order).toEqual(["beat", "save"]);
    expect(flushed).toEqual({ ok: true, value: "token-from-save" });
  });

  it("does nothing after close() — the run left this tab", async () => {
    let beats = 0;
    const scheduler = createSaveScheduler({
      send: () => Promise.resolve("saved"),
      keepAlive: () => {
        beats += 1;
        return Promise.resolve("beaten");
      },
    });
    scheduler.close();
    await scheduler.beat();
    expect(beats).toBe(0);
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

  it("a BACKGROUND send that failed is RESENT by flush — never reported as landed", async () => {
    // The audit finding of #79, as a mutation guard: `run()` used to clear
    // `dirty` before dispatching and never re-armed it on failure, so a
    // background save that died left NOTHING pending and the deadline's
    // `flush()` answered `ok: true` having sent nothing. The prova real then
    // settled a row that did not exist and showed a review screen over
    // answers that were only in the tab.
    const boom = new Error("offline");
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return Promise.reject(boom);
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(sends).toBe(1);

    const flushed = await scheduler.flush();

    // Resent (the payload is still unwritten) and reported as a FAILURE.
    expect(sends).toBe(2);
    expect(flushed).toEqual({ ok: false, error: boom });
    expect(flushed.ok).not.toBe(true);
  });

  it("flush answers ok:true once the RESEND of a failed background save lands", async () => {
    // The other half of the contract: `ok: false` must mean "still unsent",
    // not "a send failed at some point". A retry that lands is a landed run.
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return sends === 1 ? Promise.reject(new Error("blip")) : Promise.resolve("token-2");
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const flushed = await scheduler.flush();

    expect(sends).toBe(2);
    expect(flushed).toEqual({ ok: true, value: "token-2" });

    // And the re-armed flag is consumed: a second flush sends nothing.
    const again = await scheduler.flush();
    expect(sends).toBe(2);
    expect(again).toEqual({ ok: true, value: "token-2" });
  });

  it("a failed send does not resurrect a CLOSED scheduler", async () => {
    // `close()` is terminal (a CONFLICT ended this tab's run): the re-armed
    // `dirty` may not turn into a write after it.
    let sends = 0;
    const scheduler = createSaveScheduler({
      send: () => {
        sends += 1;
        return Promise.reject(new Error("offline"));
      },
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(sends).toBe(1);

    scheduler.close();
    await scheduler.flush();
    expect(sends).toBe(1);
  });
});
