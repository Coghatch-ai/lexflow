// app/src/shared/components/AiExplanationButton.tsx
//
// Cache-first AI explanation button for web. States:
//   aiExplanation present → renders <AiExplanationView> directly (no button)
//   idle → "Explicação AI" button
//   generating/polling → spinner "Gerando…"
//   done → <AiExplanationView> with relay result
//   error → red error text
//
// Used by adaptive-screens, SpacedRepetition, RealExamSimulation (quarantined sims)
// as a self-contained 1-line JSX insert — business logic stays here, not in the host.

import { useState, type ReactElement } from "react";
import { Sparkles } from "lucide-react";
import type { AiExplanation } from "@shared/domain/ai-eval";
import { runExplanationFlow } from "@shared/lib/run-explanation-flow";
import { trpc } from "../lib/trpc";
import AiExplanationView from "./AiExplanationView";

interface AiExplanationButtonProps {
  questionId: string;
  explanation: string;
  aiExplanation: AiExplanation | null | undefined;
}

export default function AiExplanationButton({
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
    <div className="mt-3 space-y-2">
      {error !== null && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#16161a] text-white text-xs font-semibold rounded-lg hover:bg-[#26262c] disabled:opacity-50 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" />
        {loading ? "Gerando…" : "Explicação AI"}
      </button>
    </div>
  );
}
