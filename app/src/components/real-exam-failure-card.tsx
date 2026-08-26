// The Simulado Real's failure screen (BR-05.5, epic #67 slice S2d — audit
// of #79). Presentational only: every string comes from `realFailure` in
// `real-exam-failures.ts`.
//
// It REPLACES the setup card rather than decorating it, and that is the whole
// point: "Iniciar Simulado Real" force-settles any pending prova real, so it
// must not be one click away from a message that says we could not tell whether
// one is pending. The only action here re-runs what failed (`retryActionFor`);
// the second door leaves the mode without touching anything.

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RealFailureCopy } from './real-exam-failures';

interface RealExamFailureCardProps {
  /**
   * Copy only (`RealFailureCopy`, not `RealFailure`): the board's deadline
   * failure renders on this same card and must NOT carry a container
   * `RealFailureKind`, whose retry map can answer `start` — the destructive one.
   */
  failure: RealFailureCopy;
  /** A retry is in flight — both buttons wait it out. */
  busy: boolean;
  onRetry: () => void;
  onExit: () => void;
}

export default function RealExamFailureCard({
  failure,
  busy,
  onRetry,
  onExit,
}: RealExamFailureCardProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-start gap-3 mb-4">
        <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
        <h3 className="text-xl font-bold text-[#16161a]">{failure.title}</h3>
      </div>

      <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-red-700">{failure.body}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onRetry}
          disabled={busy}
          className="flex-1 bg-[#16161a] text-white py-3 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
        >
          {busy ? 'Carregando...' : failure.retryLabel}
        </button>
        <button
          onClick={onExit}
          disabled={busy}
          className="flex-1 border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-50"
        >
          Voltar aos modos
        </button>
      </div>
    </div>
  );
}
