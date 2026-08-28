import { afterEach, describe, expect, it, vi } from "vitest";
import { UNSETTLED, settleWithin } from "./settle-within";

afterEach(() => {
  vi.useRealTimers();
});

/** A promise that never answers — a stalled request, in one expression. */
function hung<T extends object>(): Promise<T> {
  return new Promise<T>(() => {
    // never resolves, never rejects
  });
}

describe("settleWithin", () => {
  it("answers UNSETTLED for a promise that never settles", async () => {
    vi.useFakeTimers();
    const raced = settleWithin(hung<{ ok: boolean }>(), 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await raced).toBe(UNSETTLED);
  });

  it("does not answer BEFORE the bound — a slow send is not a failed one", async () => {
    vi.useFakeTimers();
    let answered: unknown = "still waiting";
    const raced = settleWithin(hung<{ ok: boolean }>(), 20_000).then((value) => {
      answered = value;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(answered).toBe("still waiting");
    await vi.advanceTimersByTimeAsync(1);
    await raced;
    expect(answered).toBe(UNSETTLED);
  });

  it("hands back the value untouched when it lands in time", async () => {
    vi.useFakeTimers();
    const value = { ok: true };
    const raced = settleWithin(Promise.resolve(value), 20_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(await raced).toBe(value);
  });

  it("still THROWS a rejection — only silence is converted", async () => {
    const boom = new Error("offline");
    await expect(settleWithin(Promise.reject<{ ok: boolean }>(boom), 20_000)).rejects.toBe(boom);
  });

  it("clears its timer when the value wins, so nothing is left pending", async () => {
    vi.useFakeTimers();
    expect(await settleWithin(Promise.resolve({ ok: true }), 20_000)).toEqual({ ok: true });
    // A leaked timeout would keep the bound alive after the call returned.
    expect(vi.getTimerCount()).toBe(0);
  });
});
