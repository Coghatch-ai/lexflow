// The two clocks an answering screen keeps: the RUN's elapsed seconds (BR-05.10
// — persisted, so a resumed run continues where it stopped) and the CURRENT
// question's, which restarts on every question.
//
// One hook because the two always tick together: a screen that advanced the run
// clock without resetting the question one would bank the whole run's seconds
// onto the last question answered.

import { useEffect, useState } from "react";

export interface RunClock {
  /** Seconds since the run started, `startSeconds` included (BR-05.10). */
  timer: number;
  /** Seconds on the question currently open. */
  questionTime: number;
  /** A new question is on screen — its clock starts at zero. */
  resetQuestion: () => void;
}

/**
 * @param running Ticks only while true (paused once the run ends).
 * @param startSeconds What a resume rehydrated, or 0 for a fresh run.
 */
export function useRunClock(running: boolean, startSeconds: number): RunClock {
  const [timer, setTimer] = useState(startSeconds);
  const [questionTime, setQuestionTime] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setTimer((t) => t + 1);
      setQuestionTime((t) => t + 1);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [running]);

  return {
    timer,
    questionTime,
    resetQuestion: (): void => {
      setQuestionTime(0);
    },
  };
}
