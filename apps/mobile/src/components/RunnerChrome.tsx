// apps/mobile/src/components/RunnerChrome.tsx
//
// The immersive runner's two bars, extracted from `QuestionRunner.tsx` (#86
// M2b) to keep that component inside its `max-lines-per-function` budget. Pure
// presentation: every decision — whether leaving must ask (BR-05.4), whether
// "Responder depois" is offered (BR-03) — is made by the caller.

import type { ReactElement } from "react";
import { ArrowLeft, Bookmark } from "lucide-react";

export function RunnerHeader({
  index,
  total,
  onExit,
}: {
  /** Zero-based cursor into the run's own queue. */
  index: number;
  total: number;
  /**
   * The ONLY exit door of this screen: the run is immersive (no header, no tab
   * bar, no sidebar), so there is no global navigation to intercept. The
   * app-switch and tab-close doors belong to the persistence hook's listeners.
   */
  onExit: () => void;
}): ReactElement {
  const progress = ((index + 1) / total) * 100;

  return (
    <div
      className="sticky top-0 z-10 bg-paper/95 px-4 pb-3 backdrop-blur"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <div className="flex items-center gap-3">
        <button type="button" onClick={onExit} aria-label="Sair" className="text-ink-mute">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-seal transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs font-semibold tnum text-ink-mute">
          {index + 1}/{total}
        </span>
      </div>
    </div>
  );
}

/** The question's discipline badge and its bookmark toggle (BR-04). */
export function RunnerTopRow({
  discipline,
  saved,
  onToggleBookmark,
}: {
  discipline: string;
  saved: boolean;
  onToggleBookmark: () => void;
}): ReactElement {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="badge-seal">{discipline}</p>
      <button
        type="button"
        onClick={onToggleBookmark}
        aria-label={saved ? "Remover dos salvos" : "Salvar questão"}
        aria-pressed={saved}
        className={saved ? "text-seal" : "text-ink-mute"}
      >
        <Bookmark className="h-5 w-5" fill={saved ? "currentColor" : "none"} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function RunnerActions({
  canPostpone,
  onPostpone,
  onNext,
  disabled,
  label,
}: {
  canPostpone: boolean;
  onPostpone: () => void;
  onNext: () => void;
  disabled: boolean;
  label: string;
}): ReactElement {
  return (
    <div
      className="sticky bottom-0 border-t border-line bg-surface px-4 py-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex flex-col gap-2">
        {canPostpone ? (
          <button
            type="button"
            onClick={onPostpone}
            className="w-full rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink-soft active:bg-paper-sink"
          >
            Responder depois
          </button>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          disabled={disabled}
          className="btn-primary w-full text-base"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
