// apps/mobile/src/components/QuitTestDialog.tsx
//
// The confirmation a student gets when leaving a run still in progress
// (BR-05.4, #86 M2b). Presentational ONLY: every string comes from
// `exitPrompt()` and whether the third button exists comes from
// `offersSaveAndExit()` — both in `@shared/run/exit-rules`, the same module the
// desktop dialog reads. Writing the copy again here is how two clients start
// promising different things.
//
// Mobile styling only (bottom sheet, full-width thumb targets); no `await`
// happens here. The flush belongs to the runner's handler — this component just
// reports it is running by disabling every button (`busy`), so a second tap can
// never enter a save or a recording twice.

import type { ReactElement } from "react";
import { AlertCircle } from "lucide-react";
import { offersSaveAndExit, type ExitPrompt } from "@shared/run/exit-rules";

export function QuitTestDialog({
  open,
  prompt,
  onContinue,
  onQuit,
  onSave,
  busy = false,
}: {
  open: boolean;
  prompt: ExitPrompt;
  onContinue: () => void;
  onQuit: () => void;
  /** "Salvar e sair" — only a screen whose persistence is wired passes it. */
  onSave?: (() => void) | undefined;
  /** A save or a recording is in flight: no second entry into either. */
  busy?: boolean;
}): ReactElement | null {
  if (!open) return null;

  const showSave = offersSaveAndExit(prompt, onSave);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <h2 className="text-base font-bold text-ink">{prompt.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{prompt.body}</p>

        {prompt.warning !== null ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-paper-sink p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-seal" strokeWidth={1.75} />
            <p className="text-xs leading-relaxed text-ink-soft">{prompt.warning}</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          {showSave ? (
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="btn-primary w-full text-base disabled:opacity-50"
            >
              {busy ? "Salvando…" : prompt.saveLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onQuit}
            disabled={busy}
            className={`w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50 ${
              showSave
                ? "border border-line-strong text-ink-soft active:bg-paper-sink"
                : "btn-primary text-base"
            }`}
          >
            {prompt.quitLabel}
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-ink-mute disabled:opacity-50"
          >
            {prompt.continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
