// Registry the navigation guard reads at click time (BR-05.1, slice S1b).
//
// `.ts`, NOT `.tsx`, on purpose: `react-refresh/only-export-components` is an
// error on authored `.tsx`, and this module exports hooks. The component that
// renders the dialog lives alone in `components/RunGuardProvider.tsx`.
//
// The run itself is NOT lifted: it stays in whichever answering screen owns
// it (four incompatible shapes), and each screen only registers a description
// of it plus its own "sair e processar" handler. The registration is written
// into a ref on EVERY render (an effect with no dependency array), so it never
// goes stale and never calls setState — a provider that re-rendered per answer
// would re-render the whole test tree.

import { createContext, useContext, useEffect, useId } from "react";
import type { RunRegistration } from "./lib/run-guard";

/** One registered answering screen: what it is, and how it quits+processes. */
export interface RegisteredRun {
  run: RunRegistration;
  quit: () => void;
}

export interface RunGuardValue {
  /** Live registry keyed by screen id. Same Map instance across renders. */
  runs: Map<string, RegisteredRun>;
  /**
   * Ask the guard before leaving. `next` runs immediately when nothing is at
   * risk; otherwise the exit dialog opens and `next` is dropped.
   * `targetPath === null` means logout.
   */
  requestLeave: (next: () => void, targetPath: string | null) => void;
}

// Default = no guard at all, so a tree rendered without the provider (tests,
// the signed-out router) navigates exactly as it did before this slice.
const UNGUARDED: RunGuardValue = {
  runs: new Map<string, RegisteredRun>(),
  requestLeave: (next) => {
    next();
  },
};

export const RunGuardContext = createContext<RunGuardValue>(UNGUARDED);

export function useRunGuard(): RunGuardValue {
  return useContext(RunGuardContext);
}

/**
 * Registers the calling screen's run with the guard for as long as it is
 * mounted. Must be called before any early return (rules of hooks); the id is
 * this hook's own `useId()`, so several screens may be registered at once and
 * `pickActiveRun` decides which one a leave attempt is about.
 */
export function useRegisterRun(run: Omit<RunRegistration, "id">, quit: () => void): void {
  const id = useId();
  const { runs } = useRunGuard();

  // No dependency array by design: it re-registers on every render, which is
  // what keeps `run` and `quit` current without a stale closure and without
  // re-registering only on a hand-maintained dep list.
  useEffect(() => {
    runs.set(id, { run: { id, ...run }, quit });
    return () => {
      runs.delete(id);
    };
  });
}
