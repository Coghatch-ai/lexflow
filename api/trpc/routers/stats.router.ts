// api/trpc/routers/stats.router.ts
//
// Per-user performance aggregates, computed on read from user_answers (joined
// to oab_questions for the discipline/board breakdowns). Scoped to ctx.userId.

import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, studySessions, userAnswers } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

export const statsRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const answerRows = await db
      .select({
        totalAnswered: sql<number>`count(*)::int`,
        totalCorrect: sql<number>`coalesce(sum(case when ${userAnswers.correct} then 1 else 0 end), 0)::int`,
        averageTimePerQuestion: sql<number>`coalesce(round(avg(${userAnswers.timeSpent})), 0)::int`,
      })
      .from(userAnswers)
      .where(eq(userAnswers.userId, ctx.userId));

    const sessionRows = await db
      .select({ totalSessions: sql<number>`count(*)::int` })
      .from(studySessions)
      .where(eq(studySessions.userId, ctx.userId));

    const totalAnswered = answerRows[0]?.totalAnswered ?? 0;
    const totalCorrect = answerRows[0]?.totalCorrect ?? 0;

    return {
      totalAnswered,
      totalCorrect,
      accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
      totalSessions: sessionRows[0]?.totalSessions ?? 0,
      averageTimePerQuestion: answerRows[0]?.averageTimePerQuestion ?? 0,
    };
  }),

  byDiscipline: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        discipline: oabQuestions.discipline,
        totalAnswered: sql<number>`count(*)::int`,
        totalCorrect: sql<number>`sum(case when ${userAnswers.correct} then 1 else 0 end)::int`,
        accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
      })
      .from(userAnswers)
      .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(oabQuestions.discipline);
  }),

  byExamBoard: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        examBoard: oabQuestions.examBoard,
        totalAnswered: sql<number>`count(*)::int`,
        accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
      })
      .from(userAnswers)
      .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(oabQuestions.examBoard);
  }),
});
