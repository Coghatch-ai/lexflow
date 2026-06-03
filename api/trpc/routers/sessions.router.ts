// api/trpc/routers/sessions.router.ts
//
// Records completed study sessions (a session + its individual answers) and
// lists the signed-in user's recent sessions. All writes/reads are scoped to
// ctx.userId.

import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
  spacedRepetitionConfig,
  studySessions,
  userAnswers,
  userQuestionStates,
} from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import {
  DEFAULT_SM2_CONFIG,
  DEFAULT_SM2_STATE,
  sm2Update,
  type Sm2Config,
  type Sm2State,
} from "../../../shared/domain/spaced-repetition";

type AnswerInput = { questionId: string; userAnswer: string; correct: boolean; timeSpent: number };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertSm2States(
  tx: Tx,
  userId: string,
  answers: AnswerInput[],
  sm2Config: Sm2Config,
): Promise<void> {
  const questionIds = answers.map((a) => a.questionId);
  const existing = await tx
    .select({
      questionId: userQuestionStates.questionId,
      interval: userQuestionStates.interval,
      repetitions: userQuestionStates.repetitions,
      easeFactor: userQuestionStates.easeFactor,
    })
    .from(userQuestionStates)
    .where(
      and(
        eq(userQuestionStates.userId, userId),
        inArray(userQuestionStates.questionId, questionIds),
      ),
    );

  const stateByQuestion = new Map<string, Sm2State>(
    existing.map((s) => [
      s.questionId,
      { interval: s.interval, repetitions: s.repetitions, easeFactor: parseFloat(s.easeFactor) },
    ]),
  );

  const now = new Date().toISOString();
  const rows = answers.map((a) => {
    const current = stateByQuestion.get(a.questionId) ?? {
      ...DEFAULT_SM2_STATE,
      easeFactor: sm2Config.defaultEaseFactor,
    };
    const next = sm2Update(current, a.correct, sm2Config);
    return {
      userId,
      questionId: a.questionId,
      interval: next.interval,
      repetitions: next.repetitions,
      easeFactor: next.easeFactor.toFixed(2),
      nextReviewAt: next.nextReviewAt.toISOString(),
      lastCorrect: a.correct,
      createdAt: now,
      lastUpdAt: now,
      createdBy: userId,
      lastUpdBy: userId,
    };
  });

  await tx
    .insert(userQuestionStates)
    .values(rows)
    .onConflictDoUpdate({
      target: [userQuestionStates.userId, userQuestionStates.questionId],
      set: {
        interval: sql`excluded.interval`,
        repetitions: sql`excluded.repetitions`,
        easeFactor: sql`excluded.ease_factor`,
        nextReviewAt: sql`excluded.next_review_at`,
        lastCorrect: sql`excluded.last_correct`,
        lastUpdAt: sql`excluded.last_upd_at`,
        lastUpdBy: sql`excluded.last_upd_by`,
      },
    });
}

async function loadSm2Config(): Promise<Sm2Config> {
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
}

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
    const sm2Config = await loadSm2Config();

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

      await upsertSm2States(tx, ctx.userId, input.answers, sm2Config);
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
