// Shared answer-question UI used by every simulation screen (standard,
// adaptive, spaced repetition, real exam). Renders the discipline/exam-board
// line, the question text, the selectable answer options, and optionally the
// bookmark toggle + notes textarea when the caller provides those handlers.
// The caller owns the surrounding card wrapper, any header/timer, and the
// Confirm/Next action button.

import { useRef } from "react";
import { Bookmark, X } from "lucide-react";
import {
  IDLE_SWIPE,
  type SwipeLatch,
  consumeClick,
  endSwipe,
  startSwipe,
} from "@shared/domain/eliminations";

type QuestionCardProps = {
  disciplineLabel: string;
  examBoardLabel: string;
  questionText: string;
  options: string[];
  selectedAnswer: string;
  onSelect: (option: string) => void;
  note?: string;
  onNoteChange?: (text: string) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  /** When true, option buttons are disabled (no re-selection after Conferir). */
  locked?: boolean;
  /** Highlight the correct option when locked (green = correct, red = wrong selection). */
  correctAnswer?: string;
  /** Option texts the student crossed out (BR-02). Session-only; never sent anywhere. */
  eliminatedOptions?: readonly string[];
  /**
   * Cross out / restore an option. When omitted the card behaves exactly as
   * before: no ✕ button, no swipe (the screens wired in D2 stay untouched).
   */
  onToggleEliminate?: (option: string) => void;
};

type OptionRowProps = {
  option: string;
  index: number;
  isSelected: boolean;
  isEliminated: boolean;
  locked: boolean;
  correctAnswer?: string;
  onSelect: (option: string) => void;
  onToggleEliminate?: (option: string) => void;
};

function OptionRow({
  option,
  index,
  isSelected,
  isEliminated,
  locked,
  correctAnswer,
  onSelect,
  onToggleEliminate,
}: OptionRowProps): React.JSX.Element {
  // Touch gesture state of this row (drag origin + one-shot click swallow).
  // All rules live in ../lib/eliminations so they are covered by vitest.
  const swipe = useRef<SwipeLatch>(IDLE_SWIPE);

  const isCorrect = locked && correctAnswer === option;
  const isWrong = locked && isSelected && option !== correctAnswer;

  const borderClass = isCorrect
    ? "border-green-500 bg-green-50"
    : isWrong
      ? "border-red-500 bg-red-50"
      : isEliminated
        ? "border-gray-200 bg-gray-50"
        : isSelected
          ? "border-[#16161a] bg-[#16161a]/5"
          : "border-gray-200 hover:border-[#16161a]/50";

  const circleClass = isCorrect
    ? "border-green-500 bg-green-500 text-white"
    : isWrong
      ? "border-red-500 bg-red-500 text-white"
      : isEliminated
        ? "border-gray-300 text-gray-400"
        : isSelected
          ? "border-[#16161a] bg-[#16161a] text-white"
          : "border-gray-300 text-gray-500";

  // Cross-out is off while the answer is locked (after "Conferir") and on the
  // screens that do not pass the handler.
  const eliminate = locked ? undefined : onToggleEliminate;

  return (
    <div className="flex items-stretch gap-2">
      <button
        onClick={() => {
          const clicked = consumeClick(swipe.current);
          swipe.current = clicked.latch;
          if (!clicked.selects) return;
          if (locked || isEliminated) return;
          onSelect(option);
        }}
        onTouchStart={(e) => {
          if (eliminate === undefined) return;
          const touch = e.changedTouches[0];
          // Disarms the click swallow: a swipe often gets no trailing click
          // (Chrome/Android cancels the tap past touch slop), so every new
          // gesture must start clean or it eats the next real tap.
          swipe.current = startSwipe(touch.clientX, touch.clientY);
        }}
        onTouchEnd={(e) => {
          if (eliminate === undefined) return;
          const touch = e.changedTouches[0];
          // No preventDefault: vertical drags must keep scrolling the page.
          const ended = endSwipe(swipe.current, touch.clientX, touch.clientY);
          swipe.current = ended.latch;
          if (ended.crossOut) eliminate(option);
        }}
        disabled={locked}
        aria-disabled={isEliminated}
        className={`flex-1 text-left p-4 border-2 rounded-lg transition ${borderClass} ${
          isEliminated ? "opacity-50" : ""
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-semibold ${circleClass}`}
          >
            {String.fromCharCode(65 + index)}
          </div>
          <span className={`text-gray-800 ${isEliminated ? "line-through text-gray-500" : ""}`}>
            {option}
          </span>
        </div>
      </button>

      {eliminate !== undefined && (
        <button
          onClick={() => {
            eliminate(option);
          }}
          aria-label={isEliminated ? "Restaurar alternativa" : "Descartar alternativa"}
          title={isEliminated ? "Restaurar alternativa" : "Descartar alternativa"}
          className={`px-3 rounded-lg border-2 transition flex-shrink-0 ${
            isEliminated
              ? "border-[#16161a] text-[#16161a]"
              : "border-gray-200 text-gray-400 hover:border-[#16161a]/50 hover:text-[#16161a]"
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function QuestionCard({
  disciplineLabel,
  examBoardLabel,
  questionText,
  options,
  selectedAnswer,
  onSelect,
  note,
  onNoteChange,
  isBookmarked,
  onToggleBookmark,
  locked = false,
  correctAnswer,
  eliminatedOptions,
  onToggleEliminate,
}: QuestionCardProps): React.JSX.Element {
  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-gray-600 mb-2">
          <span className="font-medium">{disciplineLabel}</span> -{" "}
          <span className="font-medium">{examBoardLabel}</span>
        </p>
        <h3 className="text-lg font-semibold text-[#16161a]">{questionText}</h3>
      </div>

      <div className="space-y-3 mb-6">
        {options.map((option, idx) => (
          <OptionRow
            // Index + text: OptionRow holds touch state, so a bare index would
            // let React reuse a row instance (and its latch) across questions.
            key={`${String(idx)}-${option}`}
            option={option}
            index={idx}
            isSelected={selectedAnswer === option}
            isEliminated={eliminatedOptions?.includes(option) === true}
            locked={locked}
            correctAnswer={correctAnswer}
            onSelect={onSelect}
            onToggleEliminate={onToggleEliminate}
          />
        ))}
      </div>

      {(onToggleBookmark !== undefined || onNoteChange !== undefined) && (
        <div className="border-t border-gray-100 pt-4 space-y-3 mb-2">
          {onToggleBookmark !== undefined && (
            <button
              onClick={onToggleBookmark}
              className={`flex items-center gap-2 text-sm font-medium transition ${
                isBookmarked === true ? "text-[#16161a]" : "text-gray-400 hover:text-[#16161a]"
              }`}
            >
              <Bookmark
                className="w-4 h-4"
                fill={isBookmarked === true ? "currentColor" : "none"}
              />
              {isBookmarked === true ? "Salvo para depois" : "Salvar para depois"}
            </button>
          )}
          {onNoteChange !== undefined && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Anotações</label>
              <textarea
                value={note ?? ""}
                onChange={(e) => {
                  onNoteChange(e.target.value);
                }}
                placeholder="Digite sua anotação..."
                rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#16161a] resize-none text-gray-700 placeholder-gray-400"
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
