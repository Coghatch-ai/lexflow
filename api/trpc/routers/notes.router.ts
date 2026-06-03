// api/trpc/routers/notes.router.ts
//
// Per-user question notes. One note per (user, question) pair — upsert on write.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { userQuestionNotes } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

export const notesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({ questionId: userQuestionNotes.questionId, noteText: userQuestionNotes.noteText })
      .from(userQuestionNotes)
      .where(ctx.db.conditions(userQuestionNotes))
      .orderBy(userQuestionNotes.createdAt);
  }),

  upsert: protectedProcedure
    .input(z.object({ questionId: z.string().min(1), noteText: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(userQuestionNotes)
        .values({
          userId: ctx.userId,
          questionId: input.questionId,
          noteText: input.noteText,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [userQuestionNotes.userId, userQuestionNotes.questionId],
          set: {
            noteText: input.noteText,
            lastUpdAt: new Date().toISOString(),
            lastUpdBy: ctx.userId,
          },
        });
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ questionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(userQuestionNotes)
        .where(
          and(
            eq(userQuestionNotes.questionId, input.questionId),
            ctx.db.conditions(userQuestionNotes),
          ),
        );
      return { ok: true as const };
    }),
});
