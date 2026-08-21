import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import QuitTestDialog from './QuitTestDialog';
import { RunGuardContext, type RegisteredRun, type RunGuardValue } from '../shared/run-guard-context';
import { decideNavigation, pickActiveRun } from '../shared/lib/run-guard';
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
export default function RunGuardProvider({ children }: { children: ReactNode }): ReactElement {
  const [location] = useLocation();
  const registryRef = useRef<Map<string, RegisteredRun>>(new Map());
  const [pending, setPending] = useState<{ prompt: ExitPrompt; id: string } | null>(null);

  // Read the registry AT CLICK TIME, never during render: registering a run
  // must not re-render the guard, and the guard must not re-render the test.
  const requestLeave = useCallback(
    (next: () => void, targetPath: string | null): void => {
      const active = pickActiveRun([...registryRef.current.values()].map((entry) => entry.run));
      const decision = decideNavigation(active, location, targetPath);
      if (decision.action === 'prompt' && active !== null) {
        setPending({ prompt: decision.prompt, id: active.id });
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

  return (
    <RunGuardContext.Provider value={value}>
      {children}
      {pending !== null && (
        <QuitTestDialog
          open
          prompt={pending.prompt}
          onContinue={() => {
            setPending(null);
          }}
          onQuit={handleQuit}
        />
      )}
    </RunGuardContext.Provider>
  );
}
