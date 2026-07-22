// shared/lib/run-tutor-flow.ts
//
// Orchestrates one tutor exchange:
//   tutorAsk → pollRelayJob → tutorFinalize → answer text
//
// Framework-agnostic (mirrors run-explanation-flow.ts): tRPC calls are injected
// as plain async functions so this is unit-testable without React or a tRPC
// client. Web and mobile panels call this with their respective trpc bindings.

import type { TutorMode } from "../domain/ai-tutor";
import { pollRelayJob, type RelayJobStatus } from "./relay-poll";

export interface TutorFlowInput {
  questionId: string;
  mode: TutorMode;
  userAnswer: string | null;
  followUp?: string;
}

export interface TutorFlowDeps {
  /** trpc.ai.tutorAsk.mutateAsync */
  ask: (input: TutorFlowInput) => Promise<{ jobId: string }>;
  /** trpc.relay.job.fetch — returns RelayJobStatus shape */
  fetchRelayJob: (jobId: string) => Promise<RelayJobStatus>;
  /** trpc.ai.tutorFinalize.mutateAsync */
  finalize: (input: { questionId: string; jobId: string }) => Promise<{ answer: string }>;
}

export async function runTutorFlow(input: TutorFlowInput, deps: TutorFlowDeps): Promise<string> {
  const { jobId } = await deps.ask(input);
  await pollRelayJob(() => deps.fetchRelayJob(jobId));
  const { answer } = await deps.finalize({ questionId: input.questionId, jobId });
  return answer;
}
