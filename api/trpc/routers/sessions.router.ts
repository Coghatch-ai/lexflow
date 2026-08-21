// api/trpc/routers/sessions.router.ts
//
// Records completed study sessions (a session + its individual answers) and
// lists the signed-in user's recent sessions. All writes/reads are scoped to
// ctx.userId.

import { z } from "zod";
import { desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import { studySessions } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { loadSm2Config } from "../../lib/sm2";
import { DraftAlreadyConsumedError, recordSession } from "../../lib/record-session";

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
  // The in-flight exam draft this session finishes, when it came from one.
  // Deleted in the same transaction (api/lib/record-session.ts), which is what
  // stops the client and the server-side settlement from both recording it.
  draftId: z.string().uuid().optional(),
});

export const sessionsRouter = router({
  record: protectedProcedure.input(recordInput).mutation(async ({ ctx, input }) => {
    const total = input.answers.length;
    const correct = input.answers.filter((a) => a.correct).length;
    const sm2Config = await loadSm2Config();

    try {
      const sessionId = await db.transaction((tx) =>
        recordSession(
          tx,
          ctx.userId,
          {
            discipline: input.discipline,
            difficulty: input.difficulty,
            answers: input.answers,
            draftId: input.draftId,
          },
          sm2Config,
        ),
      );
      return { sessionId, totalQuestions: total, correctAnswers: correct };
    } catch (err: unknown) {
      // The server (or another tab) already processed this run — nothing was
      // written here. CONFLICT, not 500: the answers are not lost, they are in
      // the session the winner created.
      if (err instanceof DraftAlreadyConsumedError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este teste já foi processado.",
        });
      }
      throw err;
    }
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
