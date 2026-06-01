// Shared answer-question UI used by every simulation screen (standard,
// adaptive, spaced repetition, real exam). Renders the discipline/exam-board
// line, the question text, and the selectable answer options with the
// selection-circle UI. The caller owns the surrounding card wrapper, any
// header/timer, and the Confirm/Next action button — this component only
// renders the inner block so the rendered design stays identical everywhere.

type QuestionCardProps = {
  disciplineLabel: string;
  examBoardLabel: string;
  questionText: string;
  options: string[];
  selectedAnswer: string;
  onSelect: (option: string) => void;
};

export default function QuestionCard({
  disciplineLabel,
  examBoardLabel,
  questionText,
  options,
  selectedAnswer,
  onSelect,
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
    </>
  );
}
