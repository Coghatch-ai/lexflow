// The two intervals the Simulado Real keeps (BR-05.5, epic #67 slice S2d).
//
// Neither is a clock in the `use-run-clock` sense: the prova real counts NOTHING
// locally. Its remaining time is derived from the absolute `deadline_at`
// (`realSecondsLeft`), so all the tick does is move "now" forward — reloading
// the tab cannot hand back time and the exam never pauses (D8).
//
// Kept out of the board because they are the two places a stale closure would
// be invisible: an interval that captured an old callback keeps firing happily
// with the wrong one.

import { useEffect, useRef, useState } from "react";

/** One beat per minute; the server calls a tab dead after 3 missed ones. */
export const HEARTBEAT_MS = 60_000;

/**
 * "Now", refreshed once a second while `running`. An ISO string rather than a
 * number because that is what the pure `realSecondsLeft` takes, and because a
 * screen holding an instant instead of a countdown cannot drift.
 */
export function useTickingNow(running: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      setNow(new Date().toISOString());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [running]);

  return now;
}

/**
 * The 60 s heartbeat (`examDrafts.touch`). The INTERVAL is the screen's; the
 * beat itself belongs to the persistence hook, which owns the token.
 *
 * `beat` is read through a ref so re-rendering per answer does not restart the
 * minute — a heartbeat that resets on every keystroke would still be correct,
 * but one that resets on every render of a 5 h exam is a request per render.
 */
export function useHeartbeat(running: boolean, beat: () => Promise<void>): void {
  const beatRef = useRef(beat);
  beatRef.current = beat;

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      void beatRef.current();
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(interval);
    };
  }, [running]);
}
