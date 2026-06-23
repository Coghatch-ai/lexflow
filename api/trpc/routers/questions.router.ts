// api/trpc/routers/questions.router.ts
//
// Read access to the global oab_questions catalog + the per-user "review queue"
// (questions the signed-in user has gotten wrong). Gated behind auth.

import { z } from "zod";
import { and, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, spacedRepetitionConfig, userQuestionStates } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { DEFAULT_SM2_CONFIG } from "../../../shared/domain/spaced-repetition";

const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.enum(["FGV", "CESPE"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const questionsRouter = router({
  list: protectedProcedure.input(listInput).query(async ({ input }) => {
    const conds: SQL[] = [];
    if (input.discipline !== undefined) conds.push(eq(oabQuestions.discipline, input.discipline));
    if (input.examBoard !== undefined) conds.push(eq(oabQuestions.examBoard, input.examBoard));
    if (input.difficulty !== undefined) conds.push(eq(oabQuestions.difficulty, input.difficulty));

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
});
