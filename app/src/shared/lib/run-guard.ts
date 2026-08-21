// Navigation guard for a test still running (BR-05.1, epic #67 slice S1b).
//
// Pure module: no React, no router. The whole decision of "may this click
// leave the run, or must it ask first?" lives here so it is provable without
// RTL/jsdom, and so the sidebar and the in-screen exits share ONE rule set.
//
// It owns no rules of its own: whether to ask (`shouldPromptOnExit`) and what
// the dialog says (`exitPrompt`) both come from `./exit-rules`. Adding a label
// or an `answeredCount > 0` here would fork BR-05 into two sources of truth.

import { exitPrompt, shouldPromptOnExit, type ExitPrompt, type RunMode } from "./exit-rules";

/**
 * What an answering screen tells the guard about its run. `id` is the
 * registering screen's key — TestingPage stays mounted while it renders the
 * other modes, so several screens can be registered at once.
 */
export interface RunRegistration {
  id: string;
  mode: RunMode;
  running: boolean;
  answeredCount: number;
  totalQuestions: number;
}

/** Either the click goes through, or the exit dialog opens instead. */
export type NavDecision = { action: "navigate" } | { action: "prompt"; prompt: ExitPrompt };

/**
 * Whether leaving this run must ask first: it exists, it is running, and
 * something was already answered. Zero answered leaves silently — there is
 * nothing to process (`sessions.record` requires at least one answer).
 */
export function isRunGuarded(run: RunRegistration | null): run is RunRegistration {
  return run !== null && run.running && shouldPromptOnExit(run.answeredCount);
}

/**
 * The run a leave attempt is really about: the first guarded registration.
 * An idle registration (mode selection, result screen) never masks the mode
 * actually running.
 */
export function pickActiveRun(runs: readonly RunRegistration[]): RunRegistration | null {
  return runs.find((run) => isRunGuarded(run)) ?? null;
}

/**
 * The decision taken AT CLICK TIME by the navigation guard.
 *
 * `targetPath === null` means logout, which never matches the current route
 * and therefore always leaves the run.
 */
export function decideNavigation(
  run: RunRegistration | null,
  currentPath: string,
  targetPath: string | null,
): NavDecision {
  // Clicking the page already open takes the student nowhere — asking there
  // would interrogate a click that leaves nothing.
  if (targetPath === currentPath) return { action: "navigate" };
  if (!isRunGuarded(run)) return { action: "navigate" };
  return {
    action: "prompt",
    prompt: exitPrompt(run.mode, run.answeredCount, run.totalQuestions),
  };
}
