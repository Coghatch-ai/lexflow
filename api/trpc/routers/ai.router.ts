// api/trpc/routers/ai.router.ts
//
// AI completions, routed through LexFlow's own relay (lexflow-relay → Gemini).
// The prompt is server-owned (api/lib/ai-prompts.ts): the client sends domain
// inputs, the API builds the variables (shared/domain/ai-eval.ts), resolves the
// template, and ENQUEUES the job to the relay outbox. The relay runs async and
// writes the result to S3; the client polls relay.job and parses the reply
// (parseGradeResponse, shared with the API). Pure procedure (no DB writes);
// persistence stays in discursive.saveAnswer (client-driven, like the self-score).

import { z } from "zod";
import { protectedProcedure, router } from "../procedures";
import { enqueueRelayJob } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { buildGradeVariables } from "../../../shared/domain/ai-eval";

const gradeInput = z.object({
  statement: z.string().min(1),
  studentAnswer: z.string().min(1),
  modelAnswer: z.string().nullable(),
  legalBasis: z.string().nullable(),
  maxPoints: z.number().positive(),
});

export const aiRouter = router({
  // 2ª-fase discursive grading. Verified user only (same gate as the self-score).
  // Returns a jobId; the client polls relay.job for the Gemini result.
  grade: protectedProcedure.input(gradeInput).mutation(async ({ ctx, input }) => {
    const payload = resolveAiPrompt("oab-grade", buildGradeVariables(input));
    const jobId = await enqueueRelayJob(ctx.userId, payload);
    return { jobId };
  }),
});
