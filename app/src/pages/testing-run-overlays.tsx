// The two overlays a persisted run can raise (BR-05, epic #67 slice S2b):
// the CONFLICT dialog and the failure message. Kept together — and out of the
// board — because they are mutually exclusive and the board is a screen, not a
// dialog host. S2c and S2d mount THIS with their own persistence.
//
// A CONFLICT wins when both are set: it is the only one with a real choice to
// make, and its two buttons already say what happens to each copy.

import type { ReactElement } from 'react';
import RunConflictDialog from './testing-run-conflict';
import RunFailureDialog from './testing-run-failure';
import type { RunPersistence } from '@shared/react/use-run-persistence';

interface RunOverlaysProps {
  persistence: RunPersistence;
  busy: boolean;
  /** CONFLICT → rehydrate from the server's copy. */
  onReload: () => void;
  /** The server's copy was discarded — start the mode over. */
  onRestart: () => void;
  /** THIS tab's copy was discarded — the server keeps its run. */
  onExitToModes: () => void;
}

export default function RunOverlays({
  persistence,
  busy,
  onReload,
  onRestart,
  onExitToModes,
}: RunOverlaysProps): ReactElement | null {
  const { conflict, failure } = persistence;

  const handleDiscard = async (): Promise<void> => {
    if (conflict?.discardTarget === 'server') {
      await persistence.discardSaved();
      onRestart();
      return;
    }
    onExitToModes();
  };

  if (conflict !== null) {
    return (
      <RunConflictDialog
        conflict={conflict}
        busy={busy}
        onReload={onReload}
        onDiscard={() => { void handleDiscard(); }}
      />
    );
  }

  if (failure !== null) {
    return (
      <RunFailureDialog failure={failure} busy={busy} onDismiss={persistence.dismissFailure} />
    );
  }

  return null;
}
