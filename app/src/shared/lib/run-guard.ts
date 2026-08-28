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
 * Whether the exit dialog offers "Salvar e sair" at all — the DOUBLE lock, in
 * one place instead of two (BR-05.3 / BR-05.5).
 *
 * Both halves are load-bearing and neither implies the other. The RULE is per
 * MODE: `exitPrompt('real')` answers `saveLabel: null`, because a prova real is
 * never saved to continue later — persisting it (slice S2d) is for the
 * auto-submit, and that is not the same thing. The HANDLER is per SCREEN: a
 * mode whose wiring has not landed keeps two buttons without forking a second
 * rule set.
 *
 * The prova real is the case that must never regress: it registers NO save
 * handler and its prompt has NO label, so the third button cannot come back by
 * someone wiring a handler in — offering it would be an escape hatch out of an
 * exam that is not allowed to be paused.
 */
export function offersSaveAndExit(prompt: ExitPrompt, save: (() => unknown) | undefined): boolean {
  return prompt.saveLabel !== null && save !== undefined;
}

/** What the guard does with its own dialog once the screen's `save()` settled. */
export interface GuardSaveOutcome {
  /** The pending navigation only runs for a run that is safely on the server. */
  navigate: boolean;
  /**
   * ALWAYS true — including on a failed save.
   *
   * The guard's dialog is `fixed inset-0 z-50` and is rendered AFTER the
   * screen, so while it is up it sits over the failure and CONFLICT dialogs
   * the screen raises to say why the save did not land. Keeping it open on
   * `false` handed the student the same dialog again with no word about the
   * error, and clicking it a second time did nothing visible — exactly the
   * silent failure this slice exists to remove.
   *
   * Dropping the pending navigation with it is deliberate and matches "sair e
   * processar": nothing was saved, so nothing may leave the run.
   */
  closeDialog: boolean;
}

/**
 * The guard's half of "Salvar e sair" (BR-05.3): navigate only when the screen
 * reported a saved run, and always get out of the screen's way.
 */
export function guardSaveOutcome(saved: boolean): GuardSaveOutcome {
  return { navigate: saved, closeDialog: true };
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
