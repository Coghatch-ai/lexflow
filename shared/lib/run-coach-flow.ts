// shared/lib/run-coach-flow.ts
//
// Orchestrates one coach-digest generation:
//   generate → cached? return immediately
//            → miss: pollRelayJob → finalize → digest
//
// Framework-agnostic (mirrors run-explanation-flow.ts): tRPC calls are injected
// as plain async functions so this is unit-testable without React or a tRPC client.

import type { CoachDigest } from "../domain/ai-coach";
import { pollRelayJob, type RelayJobStatus } from "./relay-poll";

export interface CoachFlowDeps {
  /** trpc.coach.generate.mutateAsync */
  generate: (input: { force?: boolean }) => Promise<{
    cached: boolean;
    digest: CoachDigest | null;
    jobId: string | null;
  }>;
  /** trpc.relay.job.fetch — returns RelayJobStatus shape */
  fetchRelayJob: (jobId: string) => Promise<RelayJobStatus>;
  /** trpc.coach.finalize.mutateAsync */
  finalize: (input: { jobId: string }) => Promise<{ digest: CoachDigest }>;
}

export async function runCoachFlow(force: boolean, deps: CoachFlowDeps): Promise<CoachDigest> {
  const result = await deps.generate({ force });

  if (result.cached && result.digest !== null) {
    return result.digest;
  }
  if (result.jobId === null) {
    throw new Error("A geração retornou sem jobId");
  }
  const jobId = result.jobId;

  await pollRelayJob(() => deps.fetchRelayJob(jobId));

  const { digest } = await deps.finalize({ jobId });
  return digest;
}
