// api/trpc/routers/questions.router.ts
//
// Read access to the global oab_questions catalog + the per-user "review queue"
// (questions the signed-in user has gotten wrong). Gated behind auth.

import { z } from "zod";
import { and, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import { oabQuestions, spacedRepetitionConfig, userQuestionStates } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { DEFAULT_SM2_CONFIG } from "../../../shared/domain/spaced-repetition";
import {
  buildExplainVariables,
  optionLetter,
  parseExplainResponse,
} from "../../../shared/domain/ai-eval";
import { enqueueRelayJob, getRelayJob } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";

const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.enum(["FGV", "CESPE"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  phase: z.enum(["1st", "2nd"]).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const questionsRouter = router({
  list: protectedProcedure.input(listInput).query(async ({ input }) => {
    const conds: SQL[] = [];
    if (input.discipline !== undefined) conds.push(eq(oabQuestions.discipline, input.discipline));
    if (input.examBoard !== undefined) conds.push(eq(oabQuestions.examBoard, input.examBoard));
    if (input.difficulty !== undefined) conds.push(eq(oabQuestions.difficulty, input.difficulty));
    if (input.phase !== undefined) conds.push(eq(oabQuestions.phase, input.phase));

    return db
      .select()
      .from(oabQuestions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(sql`random()`)
      .limit(input.limit);
  }),

  disciplines: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ discipline: oabQuestions.discipline })
      .from(oabQuestions)
      .orderBy(oabQuestions.discipline);
    return rows.map((r) => r.discipline);
  }),

  // Questions due for SM-2 review (next_review_at <= now). Ordered most-overdue first.
  reviewQueue: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: oabQuestions.id,
        questionText: oabQuestions.questionText,
        options: oabQuestions.options,
        correctAnswer: oabQuestions.correctAnswer,
        explanation: oabQuestions.explanation,
        aiExplanation: oabQuestions.aiExplanation,
        discipline: oabQuestions.discipline,
        examBoard: oabQuestions.examBoard,
        difficulty: oabQuestions.difficulty,
        legislationTitle: oabQuestions.legislationTitle,
        interval: userQuestionStates.interval,
        repetitions: userQuestionStates.repetitions,
        easeFactor: userQuestionStates.easeFactor,
        nextReviewAt: userQuestionStates.nextReviewAt,
        lastCorrect: userQuestionStates.lastCorrect,
      })
      .from(userQuestionStates)
      .innerJoin(oabQuestions, eq(userQuestionStates.questionId, oabQuestions.id))
      .where(
        and(
          eq(userQuestionStates.userId, ctx.userId),
          lte(userQuestionStates.nextReviewAt, sql`now()`),
        ),
      )
      .orderBy(userQuestionStates.nextReviewAt)
      .limit(20);
  }),

  // Count of questions with next_review_at <= now — for the dashboard badge.
  dueCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userQuestionStates)
      .where(
        and(
          eq(userQuestionStates.userId, ctx.userId),
          lte(userQuestionStates.nextReviewAt, sql`now()`),
        ),
      );
    return { count: row?.count ?? 0 };
  }),

  // Fetch a specific set of questions by ID — used by the "Questões Salvas" page.
  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(500) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      return db.select().from(oabQuestions).where(inArray(oabQuestions.id, input.ids));
    }),

  // Public SM-2 config (readable by all authenticated users for display purposes).
  sm2Config: protectedProcedure.query(async () => {
    const [row] = await db.select().from(spacedRepetitionConfig).limit(1);
    if (row === undefined) return DEFAULT_SM2_CONFIG;
    return {
      defaultEaseFactor: parseFloat(row.defaultEaseFactor),
      minEaseFactor: parseFloat(row.minEaseFactor),
      easeFactorCorrectBonus: parseFloat(row.easeFactorCorrectBonus),
      easeFactorWrongPenalty: parseFloat(row.easeFactorWrongPenalty),
      initialInterval: row.initialInterval,
      secondInterval: row.secondInterval,
    };
  }),

  // Get-or-generate a 4-pillar AI explanation for any 1ª-fase question.
  // Available to all signed-in students (protectedProcedure, not admin-only).
  // Returns the cached global explanation immediately when present; otherwise
  // enqueues generation via the relay — the result is written back to the global
  // oab_questions.ai_explanation column (same global cache as admin generateExplanation,
  // no per-user scope, no TABLE_SCOPE change needed).
  getOrGenerateExplanation: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select({
          id: oabQuestions.id,
          questionText: oabQuestions.questionText,
          options: oabQuestions.options,
          correctAnswer: oabQuestions.correctAnswer,
          legalBasis: oabQuestions.legalBasis,
          aiExplanation: oabQuestions.aiExplanation,
        })
        .from(oabQuestions)
        .where(eq(oabQuestions.id, input.id))
        .limit(1);

      if (row === undefined) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "NOT_FOUND", message: "Questão não encontrada" });
      }

      // Cache hit — return immediately without enqueuing.
      if (row.aiExplanation !== null) {
        return { cached: true as const, explanation: row.aiExplanation, jobId: null };
      }

      // Cache miss — enqueue generation. The relay writes the result to S3;
      // the client polls relay.job and, once done, calls questions.finalizeExplanation
      // (protectedProcedure) which re-reads the relay result server-side and persists
      // it globally. Never accept explanation text from the client.
      const payload = resolveAiPrompt(
        "oab-explain",
        buildExplainVariables({
          questionText: row.questionText,
          options: row.options,
          correctAnswer: row.correctAnswer,
          legalBasis: row.legalBasis ?? null,
        }),
      );
      const jobId = await enqueueRelayJob(ctx.userId, payload);
      return { cached: false as const, explanation: null, jobId };
    }),

  // Persist an AI explanation generated via getOrGenerateExplanation.
  // The explanation text is NEVER accepted from the client — this procedure
  // re-reads the relay result server-side (keyed by ctx.userId + jobId) and
  // validates it before writing to the global oab_questions.ai_explanation.
  // Idempotent: re-running overwrites the same global cell with relay-authored text.
  // NO TABLE_SCOPE change needed — oab_questions is the global catalog (not per-user).
  finalizeExplanation: protectedProcedure
    .input(z.object({ id: z.string().min(1), jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      if (job.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A geração ainda está em andamento" });
      }
      if (job.status === "error") {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: job.error,
        });
      }
      const raw = job.data as { text: string };

      // Fetch options + correctAnswer to derive the correct letter for stripping.
      const [qRow] = await db
        .select({ options: oabQuestions.options, correctAnswer: oabQuestions.correctAnswer })
        .from(oabQuestions)
        .where(eq(oabQuestions.id, input.id))
        .limit(1);
      const letter =
        qRow !== undefined ? optionLetter(qRow.options, qRow.correctAnswer) : undefined;

      const parsed = parseExplainResponse(raw.text, letter);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "A IA retornou um formato inesperado",
        });
      }
      await db
        .update(oabQuestions)
        .set({ aiExplanation: parsed, lastUpdAt: new Date().toISOString() })
        .where(eq(oabQuestions.id, input.id));
      return { explanation: parsed };
    }),
});
