// The CONFLICT dialog of a persisted run (BR-05.8, epic #67 slice S2b).
//
// Presentational only: both copies, both pairs of action labels and which copy
// applies come from `conflictFor` in `shared/lib/run-persistence.ts`. Nothing
// is ever overwritten silently — the student chooses which copy survives.

import type { ReactElement } from 'react';
import { AlertCircle } from 'lucide-react';
import type { RunConflict } from '../shared/lib/run-persistence';

interface RunConflictDialogProps {
  conflict: RunConflict;
  busy: boolean;
  /** Reload the server's copy and rehydrate from it. */
  onReload: () => void;
  /** Drop a copy — WHICH one is `conflict.discardTarget`. */
  onDiscard: () => void;
}

export default function RunConflictDialog({
  conflict,
  busy,
  onReload,
  onDiscard,
}: RunConflictDialogProps): ReactElement {
  return (
    // `z-[60]` for the same reason as RunFailureDialog: at the `z-50` both used
    // to share, the guard's QuitTestDialog paints later and covers this one —
    // and a background autosave can raise a CONFLICT while that dialog is open.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <h3 className="text-xl font-bold text-[#16161a]">{conflict.title}</h3>
        </div>
        <p className="text-gray-600 mb-4">{conflict.body}</p>

        <div className="flex gap-3">
          <button
            onClick={onDiscard}
            disabled={busy}
            className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition disabled:opacity-50"
          >
            {conflict.discardLabel}
          </button>
          <button
            onClick={onReload}
            disabled={busy}
            className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
          >
            {conflict.reloadLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
