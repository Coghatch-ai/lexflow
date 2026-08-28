// shared/run/exit-listeners.ts
//
// WHERE the run's exit write is triggered from (BR-05 / BR-05.5, epic #67 slice
// S2d). The write itself is `SaveScheduler.flushOnExit` (`save-scheduler.ts`);
// this module only decides which departures fire it.
//
// Extracted out of `use-run-persistence`'s effect so the wiring is provable with
// plain vitest (no jsdom): the hook keeps `useEffect(() => wireExitFlush(...))`
// and nothing else.
//
// THREE departures, not the two the browser gives us:
//   - `pagehide` — the tab is being destroyed.
//   - `visibilitychange: hidden` — mobile app-switch, the pagehide that may
//     never come.
//   - the UNMOUNT of the run's own screen — the in-SPA exit (Codex adversarial
//     review of #79). Browser BACK is the one that hurts: `popstate` is NOT
//     cancelable, so no guard can stop it (`RunGuardProvider`), the app lives
//     under a single `/testing` route whose mode is internal state, and the
//     board simply unmounts with the answers still in memory. Neither DOM event
//     fires there — the document stays visible and never unloads — so before
//     this, a student in `submit-failed` (the state that EXISTS because their
//     answers never reached the server) lost them outright by pressing Back.
//
// It raises the in-SPA exit to the tab-close guarantee level and PROMISES NOTHING
// MORE: `flushOnExit` is best-effort by construction (a write already in flight
// still owns the token, so the exit write queues behind it and may die). Same
// attempt, one more door.

/** The only thing this wiring needs from a scheduler. */
export interface ExitFlushable {
  flushOnExit: () => void;
}

/** The `addEventListener`/`removeEventListener` pair, and nothing else. */
export interface ExitEventTarget {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/** `window` and `document` as this module uses them — a fake in tests. */
export interface ExitTargets {
  window: ExitEventTarget;
  document: ExitEventTarget & { readonly visibilityState: string };
}

/**
 * Wires the three exits onto `scheduler.flushOnExit` and returns the effect
 * cleanup, which fires it one last time.
 *
 * The cleanup flush is SAFE to call unconditionally because `flushOnExit` owns
 * every "should I write?" rule already (`save-scheduler.ts`):
 *   - the run was settled/recorded/discarded → the screen called `close()` →
 *     `closed` → nothing is sent. A clean unmount issues no write.
 *   - nothing owed (last write landed, debounce empty) → nothing is sent. So a
 *     `pagehide` that already flushed cannot be double-flushed by the unmount
 *     behind it, and React's StrictMode remount in dev writes nothing.
 *   - owed but a write is in flight → it queues through `flush()` rather than
 *     overtaking the token (a CONFLICT is TERMINAL for the prova real).
 */
export function wireExitFlush(scheduler: ExitFlushable, targets: ExitTargets): () => void {
  const onHide = (): void => {
    scheduler.flushOnExit();
  };
  const onVisibility = (): void => {
    if (targets.document.visibilityState === "hidden") onHide();
  };
  targets.window.addEventListener("pagehide", onHide);
  targets.document.addEventListener("visibilitychange", onVisibility);
  return (): void => {
    targets.window.removeEventListener("pagehide", onHide);
    targets.document.removeEventListener("visibilitychange", onVisibility);
    // The third exit. Removing the listeners is not enough: an in-SPA teardown
    // fires neither of them, so without this the owed write left with the
    // component.
    onHide();
  };
}
