// api/trpc/routers/flashcards.router.ts
//
// Flashcard feature: surface due cards (SM-2 queue), first-time batches, and
// record self-rated review outcomes. All procedures are protectedProcedure —
// scoped to ctx.userId. Reuses user_question_states (no new table, no migration).

import { z } from "zod";
import { and, eq, lte, notInArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, userQuestionStates } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { toFlashcardCard } from "../../../shared/domain/flashcard";
import { upsertSm2States, loadSm2Config } from "../../lib/sm2";

const DUE_LIMIT = 20;
const NEW_BATCH_DEFAULT_LIMIT = 10;
const NEW_BATCH_MAX_LIMIT = 50;

export const flashcardsRouter = router({
  /**
   * Cards due for SM-2 review (next_review_at <= now), most-overdue first.
   * Only questions the user has previously encountered.
   */
  dueQueue: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: oabQuestions.id,
        questionText: oabQuestions.questionText,
        options: oabQuestions.options,
        correctAnswer: oabQuestions.correctAnswer,
        discipline: oabQuestions.discipline,
        explanation: oabQuestions.explanation,
        aiExplanation: oabQuestions.aiExplanation,
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
      .limit(DUE_LIMIT);

    return rows.map(toFlashcardCard);
  }),

  /**
   * A batch of questions the user has NOT yet studied (not in user_question_states).
   * Optionally filtered by discipline. Used to introduce new cards.
   */
  newBatch: protectedProcedure
    .input(
      z.object({
        discipline: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(NEW_BATCH_MAX_LIMIT).default(NEW_BATCH_DEFAULT_LIMIT),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Sub-select: question IDs already in this user's SM-2 state table.
      const seenIds = db
        .select({ questionId: userQuestionStates.questionId })
        .from(userQuestionStates)
        .where(eq(userQuestionStates.userId, ctx.userId));

      const rows = await db
        .select({
          id: oabQuestions.id,
          questionText: oabQuestions.questionText,
          options: oabQuestions.options,
          correctAnswer: oabQuestions.correctAnswer,
          discipline: oabQuestions.discipline,
          explanation: oabQuestions.explanation,
          aiExplanation: oabQuestions.aiExplanation,
        })
        .from(oabQuestions)
        .where(
          and(
            notInArray(oabQuestions.id, seenIds),
            input.discipline !== undefined
              ? eq(oabQuestions.discipline, input.discipline)
              : undefined,
          ),
        )
        .orderBy(sql`random()`)
        .limit(input.limit);

      return rows.map(toFlashcardCard);
    }),

  /**
   * Record self-rated flashcard review outcomes and update SM-2 state.
   * Does NOT write studySessions or userAnswers — keeps flashcard review
   * separate from question-practice stats.
   */
  review: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              questionId: z.string().min(1),
              known: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sm2Config = await loadSm2Config();
      const answers = input.items.map((item) => ({
        questionId: item.questionId,
        correct: item.known,
      }));

      await db.transaction(async (tx) => {
        await upsertSm2States(tx, ctx.userId, answers, sm2Config);
      });

      return { reviewed: input.items.length };
    }),
});
