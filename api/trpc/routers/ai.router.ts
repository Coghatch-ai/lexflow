// api/trpc/routers/ai.router.ts
//
// AI completions, routed through LexFlow's own relay (lexflow-relay → Gemini).
// The prompt is server-owned (api/lib/ai-prompts.ts): the client sends domain
// inputs, the API builds the variables (shared/domain/ai-eval.ts), resolves the
// template, invokes the relay synchronously, and parses the reply. Persistence of
// the discursive grade stays in discursive.saveAnswer (client-driven, like the
// self-score) — this procedure is pure (no DB writes).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../procedures";
import { invokeRelay } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { buildGradeVariables, parseGradeResponse } from "../../../shared/domain/ai-eval";

const gradeInput = z.object({
  statement: z.string().min(1),
  studentAnswer: z.string().min(1),
  modelAnswer: z.string().nullable(),
  legalBasis: z.string().nullable(),
  maxPoints: z.number().positive(),
});

export const aiRouter = router({
  // 2ª-fase discursive grading. Verified user only (same gate as the self-score).
  grade: protectedProcedure.input(gradeInput).mutation(async ({ input }) => {
    const payload = resolveAiPrompt("oab-grade", buildGradeVariables(input));
    const { text } = await invokeRelay<{ text: string }>(payload);
    const parsed = parseGradeResponse(text, input.maxPoints);
    if (parsed === null) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "Não foi possível interpretar a avaliação da IA",
      });
    }
    return parsed;
  }),
});
