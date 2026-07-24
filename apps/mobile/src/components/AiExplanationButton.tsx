// apps/mobile/src/components/AiExplanationButton.tsx
//
// Cache-first AI explanation button for mobile. Same states as the web version:
//   aiExplanation present → renders AiExplanationView directly (no button)
//   idle → "Explicação AI" button
//   generating/polling → "Gerando…"
//   done → AiExplanationView with relay result
//   error → red error text
//
// Uses mobile trpc (../lib/trpc) and repo-level shared/lib for flow + polling.
// Cannot import from app/src/**.

import { useState, type ReactElement } from "react";
import type { AiExplanation } from "@shared/domain/ai-eval";
import { runExplanationFlow } from "@shared/lib/run-explanation-flow";
import { trpc } from "../lib/trpc";
import { AiExplanationView } from "./AiExplanationView";
import { AllowanceChip } from "./AllowanceChip";

interface AiExplanationButtonProps {
  questionId: string;
  explanation: string;
  aiExplanation: AiExplanation | null | undefined;
}

export function AiExplanationButton({
  questionId,
  explanation,
  aiExplanation,
}: AiExplanationButtonProps): ReactElement {
  const [generated, setGenerated] = useState<AiExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const getOrGenerateMut = trpc.questions.getOrGenerateExplanation.useMutation();
  const finalizeMut = trpc.questions.finalizeExplanation.useMutation();

  const displayed = aiExplanation ?? generated;

  if (displayed !== null) {
    return <AiExplanationView aiExplanation={displayed} explanation={explanation} />;
  }

  async function handleClick(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await runExplanationFlow(questionId, {
        getOrGenerate: (input) => getOrGenerateMut.mutateAsync(input),
        fetchRelayJob: (jobId) => utils.relay.job.fetch({ jobId }, { staleTime: 0 }),
        finalize: (input) => finalizeMut.mutateAsync(input),
      });
      setGenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar explicação");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <AllowanceChip />
      {error !== null && <p className="text-xs text-neg">{error}</p>}
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-ink text-paper text-xs font-semibold rounded-lg disabled:opacity-50 active:opacity-70"
      >
        {loading ? "Gerando…" : "Explicação AI"}
      </button>
    </div>
  );
}
