// shared/lib/run-explanation-flow.ts
//
// Orchestrates the full get-or-generate AI explanation flow:
//   getOrGenerate → cache hit? return immediately
//                → miss: pollRelayJob → finalizeExplanation → return explanation
//
// Framework-agnostic: tRPC calls are injected as plain async functions so this
// is unit-testable without React or a tRPC client. Both web and mobile button
// components call this with their respective trpc bindings.

import type { AiExplanation } from "../domain/ai-eval";
import { pollRelayJob, type RelayJobStatus } from "./relay-poll";

export interface ExplanationFlowDeps {
  /** trpc.questions.getOrGenerateExplanation.mutateAsync */
  getOrGenerate: (input: { id: string }) => Promise<{
    cached: boolean;
    explanation: AiExplanation | null;
    jobId: string | null;
  }>;
  /** trpc.relay.job.fetch — returns RelayJobStatus shape */
  fetchRelayJob: (jobId: string) => Promise<RelayJobStatus>;
  /** trpc.questions.finalizeExplanation.mutateAsync */
  finalize: (input: { id: string; jobId: string }) => Promise<{ explanation: AiExplanation }>;
}

export async function runExplanationFlow(
  questionId: string,
  deps: ExplanationFlowDeps,
): Promise<AiExplanation> {
  const result = await deps.getOrGenerate({ id: questionId });

  if (result.cached && result.explanation !== null) {
    return result.explanation;
  }

  if (result.jobId === null) {
    throw new Error("A geração retornou sem jobId");
  }

  const jobId = result.jobId;

  await pollRelayJob(() => deps.fetchRelayJob(jobId));

  const { explanation } = await deps.finalize({ id: questionId, jobId });
  return explanation;
}
