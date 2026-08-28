import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_DEBOUNCE_MS, createSaveScheduler } from "./save-scheduler";
import { wireExitFlush, type ExitTargets } from "./exit-listeners";

// The IN-SPA exit — the one no DOM event reports (Codex adversarial review of
// #79). Browser BACK is not cancelable (`popstate`), the whole app lives under
// one `/testing` route, so the board unmounts with the document still visible
// and never unloaded: neither `pagehide` nor `visibilitychange` fires, and the
// answers were gone. Worst in `submit-failed`, the state that exists precisely
// because those answers never reached the server.

interface Fakes extends ExitTargets {
  fire: (target: "window" | "document", type: string) => void;
  hide: () => void;
}

/** `window`/`document` as plain objects — these tests run without jsdom. */
function fakeTargets(): Fakes {
  const listeners: Record<string, Map<string, Set<() => void>>> = {
    window: new Map(),
    document: new Map(),
  };
  // The fallback is TYPED because this file now lives in `shared/run/`, which the
  // backend program compiles with `noUncheckedIndexedAccess`: the index read is
  // `… | undefined` there, so a bare `new Map()` infers `Map<any, any>` and the
  // `??` union carries it out. Same map, same behaviour — only the annotation.
  const targetFor = (name: "window" | "document"): Map<string, Set<() => void>> =>
    listeners[name] ?? new Map<string, Set<() => void>>();
  const make = (name: "window" | "document"): ExitTargets["window"] => ({
    addEventListener: (type, listener): void => {
      const map = targetFor(name);
      const set = map.get(type) ?? new Set<() => void>();
      set.add(listener);
      map.set(type, set);
    },
    removeEventListener: (type, listener): void => {
      targetFor(name).get(type)?.delete(listener);
    },
  });
  const doc = { ...make("document"), visibilityState: "visible" };
  return {
    window: make("window"),
    document: doc,
    fire: (target, type): void => {
      for (const listener of targetFor(target).get(type) ?? []) listener();
    },
    hide: (): void => {
      doc.visibilityState = "hidden";
    },
  };
}

function schedulerWith(writes: string[]): ReturnType<typeof createSaveScheduler<string>> {
  return createSaveScheduler<string>({
    send: () => {
      writes.push("send");
      return Promise.resolve("token-send");
    },
    exitSend: () => {
      writes.push("exit");
      return Promise.resolve("token-exit");
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wireExitFlush", () => {
  it("issues the owed write when the run's screen UNMOUNTS (browser Back)", () => {
    const writes: string[] = [];
    const scheduler = schedulerWith(writes);
    const targets = fakeTargets();
    const cleanup = wireExitFlush(scheduler, targets);

    // An answer confirmed, then Back: no `pagehide`, no `visibilitychange` —
    // only React tearing the board down.
    scheduler.schedule();
    cleanup();

    // Not awaited on purpose: the same synchronous, keepalive-transport attempt
    // that closing the tab already got. Before the fix this was `[]`.
    expect(writes).toEqual(["exit"]);
  });

  it("writes NOTHING on a clean unmount — the run already settled", async () => {
    const writes: string[] = [];
    const scheduler = schedulerWith(writes);
    const cleanup = wireExitFlush(scheduler, fakeTargets());

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    // What every screen does when the run leaves the tab (`persistence.close()`).
    scheduler.close();
    cleanup();

    expect(writes).toEqual(["send"]);
  });

  it("does not double-flush an exit `pagehide` already issued", () => {
    const writes: string[] = [];
    const scheduler = schedulerWith(writes);
    const targets = fakeTargets();
    const cleanup = wireExitFlush(scheduler, targets);

    scheduler.schedule();
    targets.fire("window", "pagehide");
    expect(writes).toEqual(["exit"]);

    // The unmount behind the unload owes nothing — `flushOnExit` knows.
    cleanup();
    expect(writes).toEqual(["exit"]);
  });

  it("still wires both DOM exits, and drops them on cleanup", () => {
    const writes: string[] = [];
    const scheduler = schedulerWith(writes);
    const targets = fakeTargets();
    const cleanup = wireExitFlush(scheduler, targets);

    // A visible `visibilitychange` is not an exit (it fires on focus too).
    scheduler.schedule();
    targets.fire("document", "visibilitychange");
    expect(writes).toEqual([]);

    targets.hide();
    targets.fire("document", "visibilitychange");
    expect(writes).toEqual(["exit"]);

    // After cleanup the handlers are gone: a later `schedule()` is owed to
    // whatever remounts, and these two events reach nobody.
    cleanup();
    scheduler.schedule();
    targets.fire("window", "pagehide");
    targets.fire("document", "visibilitychange");
    expect(writes).toEqual(["exit"]);
  });
});
