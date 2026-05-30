// api/trpc/routers/questions.router.ts
//
// Read access to the global oab_questions catalog + the per-user "review queue"
// (questions the signed-in user has gotten wrong). Gated behind auth.

import { z } from "zod";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, userAnswers } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

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

  // Distinct questions the user has answered incorrectly (most recent first) —
  // drives the spaced-repetition review flow.
  reviewQueue: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: oabQuestions.id,
        questionText: oabQuestions.questionText,
        options: oabQuestions.options,
        correctAnswer: oabQuestions.correctAnswer,
        explanation: oabQuestions.explanation,
        discipline: oabQuestions.discipline,
        examBoard: oabQuestions.examBoard,
        difficulty: oabQuestions.difficulty,
        legislationTitle: oabQuestions.legislationTitle,
        lastAnsweredAt: sql<string>`max(${userAnswers.createdAt})`,
        timesAnswered: sql<number>`count(*)::int`,
        timesCorrect: sql<number>`sum(case when ${userAnswers.correct} then 1 else 0 end)::int`,
      })
      .from(userAnswers)
      .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
      .where(and(eq(userAnswers.userId, ctx.userId), eq(userAnswers.correct, false)))
      .groupBy(oabQuestions.id)
      .orderBy(sql`max(${userAnswers.createdAt}) desc`)
      .limit(20);
  }),
});
