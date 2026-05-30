// api/trpc/routers/stats.router.ts
//
// Per-user performance aggregates, computed on read from user_answers (joined
// to oab_questions for the discipline/board breakdowns). Scoped to ctx.userId.

import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, studySessions, userAnswers } from "../../../drizzle/schema";
import { accuracyPct } from "../../../shared/domain/scoring";
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
      accuracy: accuracyPct(totalCorrect, totalAnswered),
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

  // Error rate bucketed by how long the answer took (fast / medium / slow).
  byResponseTime: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        bucket: sql<string>`case when ${userAnswers.timeSpent} < 30 then 'fast' when ${userAnswers.timeSpent} < 90 then 'medium' else 'slow' end`,
        total: sql<number>`count(*)::int`,
        errors: sql<number>`sum(case when ${userAnswers.correct} then 0 else 1 end)::int`,
      })
      .from(userAnswers)
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(sql`1`);
  }),

  // Questions the user answered at least twice and got wrong at least twice.
  recurringErrors: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        questionId: userAnswers.questionId,
        discipline: oabQuestions.discipline,
        timesAnswered: sql<number>`count(*)::int`,
        timesWrong: sql<number>`sum(case when ${userAnswers.correct} then 0 else 1 end)::int`,
        lastAttempt: sql<string>`max(${userAnswers.createdAt})`,
      })
      .from(userAnswers)
      .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(userAnswers.questionId, oabQuestions.discipline)
      .having(sql`count(*) >= 2 and sum(case when ${userAnswers.correct} then 0 else 1 end) >= 2`)
      .orderBy(sql`max(${userAnswers.createdAt}) desc`)
      .limit(20);
  }),
});
