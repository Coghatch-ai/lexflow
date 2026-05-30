// api/trpc/routers/sessions.router.ts
//
// Records completed study sessions (a session + its individual answers) and
// lists the signed-in user's recent sessions. All writes/reads are scoped to
// ctx.userId.

import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { studySessions, userAnswers } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

const recordInput = z.object({
  discipline: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        userAnswer: z.string(),
        correct: z.boolean(),
        timeSpent: z.number().int().min(0),
      }),
    )
    .min(1),
});

export const sessionsRouter = router({
  record: protectedProcedure.input(recordInput).mutation(async ({ ctx, input }) => {
    const total = input.answers.length;
    const correct = input.answers.filter((a) => a.correct).length;

    const sessionId = await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(studySessions)
        .values({
          userId: ctx.userId,
          discipline: input.discipline,
          difficulty: input.difficulty,
          totalQuestions: total,
          correctAnswers: correct,
          endedAt: sql`now()`,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .returning({ id: studySessions.id });
      if (session === undefined) throw new Error("study_session insert returned no row");

      await tx.insert(userAnswers).values(
        input.answers.map((a) => ({
          userId: ctx.userId,
          questionId: a.questionId,
          userAnswer: a.userAnswer,
          correct: a.correct,
          timeSpent: a.timeSpent,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })),
      );
      return session.id;
    });

    return { sessionId, totalQuestions: total, correctAnswers: correct };
  }),

  listRecent: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(studySessions)
      .where(ctx.db.conditions(studySessions))
      .orderBy(desc(studySessions.createdAt))
      .limit(10);
  }),
});
