import type { ReactElement } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ExitPrompt } from '@shared/run/exit-rules';
import { offersSaveAndExit } from '@/shared/lib/run-guard';

type QuitTestDialogProps = {
  open: boolean;
  prompt: ExitPrompt;
  onContinue: () => void;
  onQuit: () => void;
  /** "Salvar e sair" — only the screens whose persistence is wired pass it. */
  onSave?: (() => void) | undefined;
  /** A save or a recording is in flight: no second entry into either. */
  busy?: boolean;
};

// Confirmation shown when the student tries to leave a test still running
// (BR-05, slices S1 + S2b). Presentational only: the rules — which labels,
// whether to warn, whether to ask at all — live in `shared/run/exit-rules.ts`.
//
// The third action is rendered when the RULE allows it (`prompt.saveLabel`,
// BR-05.3) AND the screen actually handed over an `onSave`. Both conditions on
// purpose: the rule is per MODE, the handler is per SCREEN, and until the
// Espaçada/Adaptativo wiring lands (#78) those two screens keep two buttons
// without a second, forked prompt.
//
// No `await` happens here. The flush belongs to the screen's own handler; this
// component only reports it is running by disabling every button (`busy`), so
// there is never a second entry into a save or a recording.
export default function QuitTestDialog({
  open,
  prompt,
  onContinue,
  onQuit,
  onSave,
  busy = false,
}: QuitTestDialogProps): ReactElement | null {
  if (!open) return null;

  const showSave = offersSaveAndExit(prompt, onSave);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-xl font-bold text-[#16161a] mb-4">{prompt.title}</h3>
        <p className="text-gray-600 mb-4">{prompt.body}</p>

        {prompt.warning !== null && (
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{prompt.warning}</p>
          </div>
        )}

        {showSave && (
          <button
            onClick={onSave}
            disabled={busy}
            className="w-full mb-3 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
          >
            {busy ? 'Salvando...' : prompt.saveLabel}
          </button>
        )}

        <div className="flex gap-3">
          <button
            onClick={onContinue}
            disabled={busy}
            className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition disabled:opacity-50"
          >
            {prompt.continueLabel}
          </button>
          <button
            onClick={onQuit}
            disabled={busy}
            className={`flex-1 py-2 rounded-lg font-semibold transition disabled:opacity-50 ${showSave ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-[#16161a] text-white hover:bg-[#26262c]'}`}
          >
            {prompt.quitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
