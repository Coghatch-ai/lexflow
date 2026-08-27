import { useRef, type ReactElement } from "react";
import { Check, X } from "lucide-react";
import {
  IDLE_SWIPE,
  type SwipeLatch,
  consumeClick,
  endSwipe,
  startSwipe,
} from "@shared/domain/eliminations";

// One alternative row of the mobile QuestionRunner. Extracted from
// QuestionRunner.tsx (#85) so the runner stays under the .tsx
// max-lines-per-function budget while carrying cross-out (BR-02).
//
// Same affordances as the desktop `QuestionCard` row: sideways swipe on the row
// OR the ✕ next to it, both toggling. The gesture RULES live in
// shared/domain/eliminations (unit-tested with plain vitest); this component
// only parks the latch in a ref, because there is no jsdom/RTL here.

export function RunnerOption({
  option,
  selected,
  correctAnswer,
  answered,
  isEliminated,
  onChoose,
  onToggleEliminate,
}: {
  option: string;
  selected: string | null;
  correctAnswer: string;
  answered: boolean;
  /** Crossed out for this question (BR-02): dimmed, struck through, unselectable. */
  isEliminated: boolean;
  onChoose: (option: string) => void;
  /**
   * Cross out / restore. Undefined once the answer is revealed — the cross-out
   * freezes at the choice (BR-02.5), it is not editable feedback.
   */
  onToggleEliminate?: (option: string) => void;
}): ReactElement {
  // Touch state of this row (drag origin + one-shot click swallow).
  const swipe = useRef<SwipeLatch>(IDLE_SWIPE);

  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        disabled={answered}
        aria-disabled={isEliminated}
        onClick={() => {
          const clicked = consumeClick(swipe.current);
          swipe.current = clicked.latch;
          if (!clicked.selects) return;
          if (isEliminated) return;
          onChoose(option);
        }}
        onTouchStart={(e) => {
          if (onToggleEliminate === undefined) return;
          const touch = e.changedTouches[0];
          // Disarms the click swallow: a swipe often gets no trailing click
          // (Chrome/Android cancels the tap past touch slop), so every gesture
          // must start clean or it eats the next real tap.
          swipe.current = startSwipe(touch.clientX, touch.clientY);
        }}
        onTouchEnd={(e) => {
          if (onToggleEliminate === undefined) return;
          const touch = e.changedTouches[0];
          // No preventDefault: vertical drags must keep scrolling the page.
          const ended = endSwipe(swipe.current, touch.clientX, touch.clientY);
          swipe.current = ended.latch;
          if (ended.crossOut) onToggleEliminate(option);
        }}
        className={optionClass(option, selected, correctAnswer, isEliminated)}
      >
        <span className={`flex-1 ${isEliminated ? "line-through" : ""}`}>{option}</span>
        {answered && option === correctAnswer ? (
          <Check className="h-5 w-5 shrink-0 text-pos" />
        ) : null}
        {answered && option === selected && option !== correctAnswer ? (
          <X className="h-5 w-5 shrink-0 text-neg" />
        ) : null}
      </button>

      {onToggleEliminate === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onToggleEliminate(option);
          }}
          aria-label={isEliminated ? "Restaurar alternativa" : "Descartar alternativa"}
          aria-pressed={isEliminated}
          className={`shrink-0 rounded-xl border px-3 transition ${
            isEliminated ? "border-ink text-ink" : "border-line text-ink-mute active:bg-paper-sink"
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function optionClass(
  option: string,
  selected: string | null,
  correctAnswer: string,
  isEliminated: boolean,
): string {
  const base =
    "flex items-center gap-2 flex-1 rounded-xl border px-4 py-3.5 text-left text-sm font-medium transition";
  if (selected === null) {
    return isEliminated
      ? `${base} border-line bg-surface text-ink-mute opacity-50`
      : `${base} border-line-strong bg-surface text-ink active:bg-paper-sink`;
  }
  // Answered: the green/red highlight takes over (BR-02.5); a crossed-out row
  // that is neither just stays dimmed.
  if (option === correctAnswer) {
    return `${base} border-pos bg-pos/10 text-ink`;
  }
  if (option === selected) {
    return `${base} border-neg bg-neg/10 text-ink`;
  }
  return `${base} border-line bg-surface text-ink-mute ${isEliminated ? "opacity-50" : "opacity-60"}`;
}
