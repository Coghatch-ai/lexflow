// api/trpc/routers/questions.router.ts
//
// Read access to the global oab_questions catalog. Gated behind auth
// (protectedProcedure) even though the rows are not user-scoped.

import { z } from "zod";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.enum(["FGV", "CESPE"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const questionsRouter = router({
  list: protectedProcedure.input(listInput).query(async ({ input }) => {
    const conds: SQL[] = [];
    if (input.discipline !== undefined) conds.push(eq(oabQuestions.discipline, input.discipline));
    if (input.examBoard !== undefined) conds.push(eq(oabQuestions.examBoard, input.examBoard));
    if (input.difficulty !== undefined) conds.push(eq(oabQuestions.difficulty, input.difficulty));

    return db
      .select()
      .from(oabQuestions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(sql`random()`)
      .limit(input.limit);
  }),

  disciplines: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ discipline: oabQuestions.discipline })
      .from(oabQuestions)
      .orderBy(oabQuestions.discipline);
    return rows.map((r) => r.discipline);
  }),
});
