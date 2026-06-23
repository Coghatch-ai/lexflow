// app/src/shared/components/AiExplanationView.tsx
//
// Renders a 4-pillar AI explanation (whyCorrect, whyWrong per option, memoryTip,
// commonTraps) when structured data is available, or falls back to the flat
// `explanation` string for questions that haven't been AI-explained yet.
// Used by adaptive-screens, SpacedRepetition, RealExamSimulation, and the
// admin question form — extract here to avoid 4 copies (conventions §2).

import type { ReactElement } from "react";
import type { AiExplanation } from "@shared/domain/ai-eval";

interface AiExplanationViewProps {
  aiExplanation: AiExplanation | null | undefined;
  explanation: string;
}

export default function AiExplanationView({
  aiExplanation,
  explanation,
}: AiExplanationViewProps): ReactElement {
  if (aiExplanation === null || aiExplanation === undefined) {
    return <p className="text-gray-800">{explanation}</p>;
  }

  const wrongEntries = Object.entries(aiExplanation.whyWrong);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-green-700 mb-1">Por que a correta está certa</p>
        <p className="text-gray-800 text-sm">{aiExplanation.whyCorrect}</p>
      </div>

      {wrongEntries.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-red-700 mb-1">Por que as outras estão erradas</p>
          <div className="space-y-1">
            {wrongEntries.map(([letter, reason]) => (
              <div key={letter} className="flex gap-2 text-sm">
                <span className="font-bold text-red-600 shrink-0">{letter}:</span>
                <span className="text-gray-800">{reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-blue-700 mb-1">Dica de memorização</p>
        <p className="text-gray-800 text-sm">{aiExplanation.memoryTip}</p>
      </div>

      <div>
        <p className="text-sm font-semibold text-amber-700 mb-1">Pegadinhas comuns</p>
        <p className="text-gray-800 text-sm">{aiExplanation.commonTraps}</p>
      </div>
    </div>
  );
}
