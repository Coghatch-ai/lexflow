import type { ReactElement } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ExitPrompt } from '@/shared/lib/exit-rules';

type QuitTestDialogProps = {
  open: boolean;
  prompt: ExitPrompt;
  onContinue: () => void;
  onQuit: () => void;
};

// Confirmation shown when the student tries to leave a test still running
// (BR-05, slice S1). Presentational only: the rules — which labels, whether to
// warn, whether to ask at all — live in `shared/lib/exit-rules.ts`.
// Exactly two actions in this slice; "Salvar e sair" arrives with the
// server-side storage of a later slice and must NOT be rendered here yet.
export default function QuitTestDialog({
  open,
  prompt,
  onContinue,
  onQuit,
}: QuitTestDialogProps): ReactElement | null {
  if (!open) return null;

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

        <div className="flex gap-3">
          <button
            onClick={onContinue}
            className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
          >
            {prompt.continueLabel}
          </button>
          <button
            onClick={onQuit}
            className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition"
          >
            {prompt.quitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
