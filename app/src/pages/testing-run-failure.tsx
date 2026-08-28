// The failure message of a persisted run's EXIT (BR-05, epic #67 slice S2b).
//
// A CONFLICT has its own dialog with two real choices; this is the other half:
// offline, an expired session, a 500, or a claim that could not be confirmed.
// Before it existed the student clicked "Finalizar", nothing happened, and the
// natural reaction — clicking again — was the double-count of finding 1.
//
// Presentational only: every string comes from `saveFailureFor` /
// `runSaveFailure` in `shared/lib/run-persistence.ts`. Closing IS the retry —
// the run is still on screen, untouched.

import type { ReactElement } from 'react';
import { WifiOff } from 'lucide-react';
import type { RunSaveFailure } from '../shared/lib/run-persistence';

interface RunFailureDialogProps {
  failure: RunSaveFailure;
  busy: boolean;
  onDismiss: () => void;
}

export default function RunFailureDialog({
  failure,
  busy,
  onDismiss,
}: RunFailureDialogProps): ReactElement {
  return (
    // `z-[60]`, above the `z-50` of QuitTestDialog: the navigation guard renders
    // ITS copy of that dialog after the whole tree, so at equal z-index the guard
    // wins on DOM order and this message is born behind a backdrop. It explains
    // why the guard's own action failed — it can never be the covered one.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <WifiOff className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          <h3 className="text-xl font-bold text-[#16161a]">{failure.title}</h3>
        </div>
        <p className="text-gray-600 mb-4">{failure.body}</p>

        <button
          onClick={onDismiss}
          disabled={busy}
          className="w-full bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
        >
          {failure.dismissLabel}
        </button>
      </div>
    </div>
  );
}
