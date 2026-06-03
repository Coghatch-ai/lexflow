// api/trpc/routers/bookmarks.router.ts
//
// Per-user bookmarks ("save for later"). Toggle adds or removes the bookmark
// for a given question and returns the new bookmarked state.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { userBookmarks } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

export const bookmarksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({ questionId: userBookmarks.questionId })
      .from(userBookmarks)
      .where(ctx.db.conditions(userBookmarks));
    return rows.map((r) => r.questionId);
  }),

  toggle: protectedProcedure
    .input(z.object({ questionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db
        .select({ id: userBookmarks.id })
        .from(userBookmarks)
        .where(
          and(eq(userBookmarks.userId, ctx.userId), eq(userBookmarks.questionId, input.questionId)),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .delete(userBookmarks)
          .where(
            and(
              eq(userBookmarks.userId, ctx.userId),
              eq(userBookmarks.questionId, input.questionId),
            ),
          );
        return { bookmarked: false as const };
      }

      await db.insert(userBookmarks).values({
        userId: ctx.userId,
        questionId: input.questionId,
        createdBy: ctx.userId,
        lastUpdBy: ctx.userId,
      });
      return { bookmarked: true as const };
    }),
});
