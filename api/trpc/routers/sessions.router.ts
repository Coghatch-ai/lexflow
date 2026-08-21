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
  //
  // The id NEVER travels alone: `lastSavedAt` is the token the tab last observed
  // for that draft (from `examDrafts.save`/`touch`/`get`), and the claiming
  // delete matches on it. De-duplicating by id alone is not enough — two tabs of
  // the SAME student are the failure case: tab A holds an old run, tab B saves
  // (moving `last_saved_at`), and an id-only claim would let A delete B's fresher
  // row and record A's stale answers. With the token, A's claim matches 0 rows
  // and returns CONFLICT with the run intact. Pairing them in ONE object is the
  // point: a second optional field can be forgotten, and forgetting it is
  // exactly what silently disables the guard.
  draft: z.object({ id: z.string().uuid(), lastSavedAt: z.string().min(1) }).optional(),
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
            // Always token-guarded: the browser path has no `force` variant —
            // only startReal (BR-05.5) claims a draft unconditionally.
            draft: input.draft,
          },
          sm2Config,
        ),
      );
      return { sessionId, totalQuestions: total, correctAnswers: correct };
    } catch (err: unknown) {
      // The server (or another tab) already processed this run, or the draft
      // MOVED since this tab last saw it (another tab saved/continued it) —
      // either way nothing was written here. CONFLICT, not 500: no answer is
      // lost, they are either in the session the winner created or still in the
      // live draft this call refused to overwrite.
      if (err instanceof DraftAlreadyConsumedError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este teste já foi processado ou continuado em outro aparelho.",
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
