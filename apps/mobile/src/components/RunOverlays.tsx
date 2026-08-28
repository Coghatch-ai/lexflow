// apps/mobile/src/components/RunOverlays.tsx
//
// The two overlays a persisted run can raise (BR-05, #86 M2b): the CONFLICT
// dialog and the failure message. Mobile presentation of the SAME copies the
// desktop shows — `conflictFor()` / `saveFailureFor()` in
// `@shared/run/run-persistence` own every string, including the two labels and
// which copy is discarded.
//
// A CONFLICT wins when both are set: it is the only one with a real choice to
// make, and its buttons already say what happens to each copy.

import type { ReactElement } from "react";
import type { RunPersistence } from "@shared/react/use-run-persistence";

export function RunOverlays({
  persistence,
  busy,
  onReload,
  onRestart,
  onExit,
}: {
  persistence: RunPersistence;
  busy: boolean;
  /** CONFLICT → rehydrate from the server's copy. */
  onReload: () => void;
  /** The server's copy was discarded — start this mode over. */
  onRestart: () => void;
  /** THIS device's copy was discarded — the server keeps its run. */
  onExit: () => void;
}): ReactElement | null {
  const { conflict, failure } = persistence;

  const handleDiscard = async (): Promise<void> => {
    if (conflict?.discardTarget === "server") {
      await persistence.discardSaved();
      onRestart();
      return;
    }
    onExit();
  };

  if (conflict !== null) {
    return (
      <Sheet title={conflict.title} body={conflict.body}>
        <button
          type="button"
          onClick={onReload}
          disabled={busy}
          className="btn-primary w-full text-base disabled:opacity-50"
        >
          {conflict.reloadLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleDiscard();
          }}
          disabled={busy}
          className="w-full rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink-soft disabled:opacity-50 active:bg-paper-sink"
        >
          {conflict.discardLabel}
        </button>
      </Sheet>
    );
  }

  if (failure !== null) {
    return (
      <Sheet title={failure.title} body={failure.body}>
        <button
          type="button"
          onClick={persistence.dismissFailure}
          disabled={busy}
          className="btn-primary w-full text-base disabled:opacity-50"
        >
          {failure.dismissLabel}
        </button>
      </Sheet>
    );
  }

  return null;
}

/** The shared bottom-sheet shell — the overlays differ only in their buttons. */
function Sheet({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactElement[] | ReactElement;
}): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
        <div className="mt-4 flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
