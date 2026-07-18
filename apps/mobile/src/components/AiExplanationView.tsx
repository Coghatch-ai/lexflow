// apps/mobile/src/components/AiExplanationView.tsx
//
// Renders a 4-pillar AI explanation (whyCorrect, whyWrong, memoryTip, commonTraps)
// or falls back to the flat explanation string. Mobile counterpart of
// app/src/shared/components/AiExplanationView.tsx — cannot import from app/src/.

import type { ReactElement } from "react";
import type { AiExplanation } from "@shared/domain/ai-eval";

interface AiExplanationViewProps {
  aiExplanation: AiExplanation | null | undefined;
  explanation: string;
}

export function AiExplanationView({
  aiExplanation,
  explanation,
}: AiExplanationViewProps): ReactElement {
  if (aiExplanation === null || aiExplanation === undefined) {
    return <p className="text-sm leading-relaxed text-ink-soft">{explanation}</p>;
  }

  const wrongEntries = Object.entries(aiExplanation.whyWrong);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-pos mb-1">Por que a correta está certa</p>
        <p className="text-sm text-ink-soft">{aiExplanation.whyCorrect}</p>
      </div>

      {wrongEntries.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neg mb-1">Por que as outras estão erradas</p>
          <div className="space-y-1">
            {wrongEntries.map(([letter, reason]) => (
              <div key={letter} className="flex gap-2 text-sm">
                <span className="font-bold text-neg shrink-0">{letter}:</span>
                <span className="text-ink-soft">{reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-seal mb-1">Dica de memorização</p>
        <p className="text-sm text-ink-soft">{aiExplanation.memoryTip}</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-amber-600 mb-1">Pegadinhas comuns</p>
        <p className="text-sm text-ink-soft">{aiExplanation.commonTraps}</p>
      </div>
    </div>
  );
}
