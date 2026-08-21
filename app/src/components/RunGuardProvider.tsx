import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import QuitTestDialog from './QuitTestDialog';
import { RunGuardContext, type RegisteredRun, type RunGuardValue } from '../shared/run-guard-context';
import { decideNavigation, guardSaveOutcome, pickActiveRun } from '../shared/lib/run-guard';
import type { ExitPrompt } from '../shared/lib/exit-rules';

// Navigation guard for a test still running (BR-05.1, epic #67 slice S1b).
//
// Wouter 3.10 has no `useBlocker`, and a new dependency is out (CLAUDE.md), so
// the interception happens at the SOURCE of the navigation: the sidebar and
// the logout button call `requestLeave` instead of navigating directly. Sits
// inside <Router> (it needs `useLocation`) and above <Layout> (Layout consumes
// it). The browser Back button is knowingly NOT covered: `popstate` is not
// cancelable — the real net for that is the S2 persistence.
//
// Presentational contract: the SAME `QuitTestDialog` and the same
// `exit-rules` prompt the in-screen exits use — no sidebar-only variant.

/** A leave attempt waiting on the student's answer. */
interface PendingExit {
  prompt: ExitPrompt;
  /** Registry key of the run the attempt is about. */
  id: string;
  /** The navigation that was intercepted; only "Salvar e sair" runs it. */
  next: () => void;
  /** The active screen registered a `save` handler (S2b onwards). */
  canSave: boolean;
}

export default function RunGuardProvider({ children }: { children: ReactNode }): ReactElement {
  const [location] = useLocation();
  const registryRef = useRef<Map<string, RegisteredRun>>(new Map());
  // `next` is KEPT here (S2b): "Salvar e sair" is the one action that must
  // still navigate afterwards — "sair e processar" deliberately drops it.
  const [pending, setPending] = useState<PendingExit | null>(null);
  const [busy, setBusy] = useState(false);

  // Read the registry AT CLICK TIME, never during render: registering a run
  // must not re-render the guard, and the guard must not re-render the test.
  const requestLeave = useCallback(
    (next: () => void, targetPath: string | null): void => {
      const active = pickActiveRun([...registryRef.current.values()].map((entry) => entry.run));
      const decision = decideNavigation(active, location, targetPath);
      if (decision.action === 'prompt' && active !== null) {
        // Whether the third button exists is decided here, at click time, from
        // the same registry read — never from a render-time lookup.
        const canSave = registryRef.current.get(active.id)?.save !== undefined;
        setPending({ prompt: decision.prompt, id: active.id, next, canSave });
        return;
      }
      next();
    },
    [location],
  );

  const value = useMemo<RunGuardValue>(
    () => ({ runs: registryRef.current, requestLeave }),
    [requestLeave],
  );

  // "Sair e processar respostas" runs the active screen's own handler — the
  // same one its in-screen exit calls — and the pending navigation is DROPPED:
  // the student stays on the result screen the mode shows, which is the receipt
  // that the answers counted (BR-05.1/.7). Recording from a component about to
  // unmount would risk the react-query invalidate never running.
  const handleQuit = (): void => {
    if (pending !== null) registryRef.current.get(pending.id)?.quit();
    setPending(null);
  };

  // "Salvar e sair" (BR-05.3, slice S2b). The flush lives in the SCREEN's
  // handler, not here — this only waits for it, because navigating first would
  // unmount the screen that has to show a CONFLICT.
  //
  // What happens to THIS dialog afterwards is `guardSaveOutcome`, and on a
  // failed save it closes too: it is `z-50` and painted after the screen, so
  // leaving it up buries the failure/CONFLICT dialog the screen just raised
  // behind its own backdrop. The student then sees the unchanged dialog and
  // clicks into the void — the very symptom this slice removed elsewhere.
  const handleSave = (): void => {
    if (pending === null) return;
    const save = registryRef.current.get(pending.id)?.save;
    if (save === undefined) {
      setPending(null);
      return;
    }
    const { next } = pending;
    setBusy(true);
    void save().then(
      (saved) => {
        setBusy(false);
        const outcome = guardSaveOutcome(saved);
        if (outcome.closeDialog) setPending(null);
        if (outcome.navigate) next();
      },
      () => {
        // A REJECTION is not a reported failure: the screen showed nothing, so
        // the dialog stays as the only thing left to click (busy is cleared,
        // so the retry is live). `handleSaveAndExit` resolves false instead of
        // throwing, so this is the unreachable-by-design branch.
        setBusy(false);
      },
    );
  };

  return (
    <RunGuardContext.Provider value={value}>
      {children}
      {pending !== null && (
        <QuitTestDialog
          open
          prompt={pending.prompt}
          busy={busy}
          onContinue={() => {
            setPending(null);
          }}
          onQuit={handleQuit}
          onSave={pending.canSave ? handleSave : undefined}
        />
      )}
    </RunGuardContext.Provider>
  );
}
