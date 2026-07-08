// api/lib/sm2.ts
//
// Shared SM-2 helpers used by both sessions.router and flashcards.router.
// Extracted from sessions.router to avoid duplication (conventions.md rule 2).

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { spacedRepetitionConfig, userQuestionStates } from "../../drizzle/schema";
import {
  DEFAULT_SM2_CONFIG,
  DEFAULT_SM2_STATE,
  sm2Update,
  type Sm2Config,
  type Sm2State,
} from "../../shared/domain/spaced-repetition";

export type Sm2AnswerInput = {
  questionId: string;
  correct: boolean;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function upsertSm2States(
  tx: Tx,
  userId: string,
  answers: Sm2AnswerInput[],
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

export async function loadSm2Config(): Promise<Sm2Config> {
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
