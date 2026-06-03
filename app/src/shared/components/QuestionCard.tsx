// Shared answer-question UI used by every simulation screen (standard,
// adaptive, spaced repetition, real exam). Renders the discipline/exam-board
// line, the question text, the selectable answer options, and optionally the
// bookmark toggle + notes textarea when the caller provides those handlers.
// The caller owns the surrounding card wrapper, any header/timer, and the
// Confirm/Next action button.

import { Bookmark } from "lucide-react";

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
};

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
          <button
            key={idx}
            onClick={() => {
              onSelect(option);
            }}
            className={`w-full text-left p-4 border-2 rounded-lg transition ${
              selectedAnswer === option
                ? "border-[#16161a] bg-[#16161a]/5"
                : "border-gray-200 hover:border-[#16161a]/50"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  selectedAnswer === option ? "border-[#16161a] bg-[#16161a]" : "border-gray-300"
                }`}
              >
                {selectedAnswer === option && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
              <span className="text-gray-800">{option}</span>
            </div>
          </button>
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
