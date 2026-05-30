// api/trpc/routers/goals.router.ts
//
// Per-user study goals (target accuracy per discipline). All reads/writes are
// scoped to ctx.userId. "Current accuracy" / progress is derived on the
// frontend by combining list() with stats.byDiscipline.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { userGoals } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

export const goalsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: userGoals.id,
        discipline: userGoals.discipline,
        targetAccuracy: userGoals.targetAccuracy,
      })
      .from(userGoals)
      .where(ctx.db.conditions(userGoals))
      .orderBy(userGoals.discipline);
    return rows.map((r) => ({
      id: r.id,
      discipline: r.discipline,
      targetAccuracy: Number(r.targetAccuracy),
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({ discipline: z.string().min(1), targetAccuracy: z.number().int().min(0).max(100) }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(userGoals)
        .values({
          userId: ctx.userId,
          discipline: input.discipline,
          targetAccuracy: String(input.targetAccuracy),
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .returning({ id: userGoals.id });
      if (row === undefined) throw new Error("goal insert returned no row");
      return { id: row.id };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), targetAccuracy: z.number().int().min(0).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(userGoals)
        .set({
          targetAccuracy: String(input.targetAccuracy),
          lastUpdAt: new Date().toISOString(),
          lastUpdBy: ctx.userId,
        })
        .where(and(eq(userGoals.id, input.id), ctx.db.conditions(userGoals)));
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(userGoals)
        .where(and(eq(userGoals.id, input.id), ctx.db.conditions(userGoals)));
      return { ok: true as const };
    }),
});
