// api/trpc/routers/admin.router.ts
//
// Admin procedures for managing the global oab_questions catalog.
// All routes require users.role === "admin" (adminProcedure).
// Queries hit the raw db client directly — oab_questions is a global table,
// not user-scoped.

import { z } from "zod";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions } from "../../../drizzle/schema";
import { adminProcedure, router } from "../procedures";
import { adminQuestionInputSchema } from "../../../shared/domain/admin-question";

const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.string().min(1).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});

function generateId(): string {
  return `qi${Date.now()}`;
}

export const adminRouter = router({
  questions: router({
    list: adminProcedure.input(listInput).query(async ({ input }) => {
      const conds: SQL[] = [];
      if (input.discipline !== undefined) conds.push(eq(oabQuestions.discipline, input.discipline));
      if (input.examBoard !== undefined) conds.push(eq(oabQuestions.examBoard, input.examBoard));
      if (input.difficulty !== undefined) conds.push(eq(oabQuestions.difficulty, input.difficulty));

      const where = conds.length > 0 ? and(...conds) : undefined;

      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(oabQuestions)
          .where(where)
          .orderBy(asc(oabQuestions.id))
          .offset(input.offset)
          .limit(input.limit),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(oabQuestions)
          .where(where),
      ]);

      return { rows, total: countRows[0]?.total ?? 0 };
    }),

    get: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(oabQuestions)
        .where(eq(oabQuestions.id, input.id))
        .limit(1);
      return row ?? null;
    }),

    create: adminProcedure.input(adminQuestionInputSchema).mutation(async ({ input }) => {
      const id = input.id !== undefined && input.id.length > 0 ? input.id : generateId();
      const now = new Date().toISOString();
      await db.insert(oabQuestions).values({
        id,
        questionText: input.questionText,
        options: input.options,
        correctAnswer: input.correctAnswer,
        legalBasis: input.legalBasis,
        explanation: input.explanation,
        legislationLink: input.legislationLink,
        legislationTitle: input.legislationTitle,
        difficulty: input.difficulty,
        discipline: input.discipline,
        topic: input.topic,
        examBoard: input.examBoard,
        year: input.year,
        phase: input.phase,
        createdAt: now,
        lastUpdAt: now,
      });
      return { id };
    }),

    update: adminProcedure
      .input(adminQuestionInputSchema.extend({ id: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await db
          .update(oabQuestions)
          .set({
            questionText: input.questionText,
            options: input.options,
            correctAnswer: input.correctAnswer,
            legalBasis: input.legalBasis,
            explanation: input.explanation,
            legislationLink: input.legislationLink,
            legislationTitle: input.legislationTitle,
            difficulty: input.difficulty,
            discipline: input.discipline,
            topic: input.topic,
            examBoard: input.examBoard,
            year: input.year,
            phase: input.phase,
            lastUpdAt: new Date().toISOString(),
          })
          .where(eq(oabQuestions.id, input.id));
        return { ok: true as const };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await db.delete(oabQuestions).where(eq(oabQuestions.id, input.id));
        return { ok: true as const };
      }),

    bulkUpsert: adminProcedure
      .input(z.array(adminQuestionInputSchema).min(1).max(500))
      .mutation(async ({ input }) => {
        const now = new Date().toISOString();
        let autoIdCounter = 0;

        const rows = input.map((q) => {
          const id =
            q.id !== undefined && q.id.length > 0 ? q.id : `qi${Date.now()}_${autoIdCounter++}`;
          return {
            id,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: q.correctAnswer,
            legalBasis: q.legalBasis,
            explanation: q.explanation,
            legislationLink: q.legislationLink,
            legislationTitle: q.legislationTitle,
            difficulty: q.difficulty,
            discipline: q.discipline,
            topic: q.topic,
            examBoard: q.examBoard,
            year: q.year,
            phase: q.phase,
            createdAt: now,
            lastUpdAt: now,
          };
        });

        const BATCH = 100;
        for (let i = 0; i < rows.length; i += BATCH) {
          await db
            .insert(oabQuestions)
            .values(rows.slice(i, i + BATCH))
            .onConflictDoUpdate({
              target: oabQuestions.id,
              set: {
                questionText: sql`excluded.question_text`,
                options: sql`excluded.options`,
                correctAnswer: sql`excluded.correct_answer`,
                legalBasis: sql`excluded.legal_basis`,
                explanation: sql`excluded.explanation`,
                legislationLink: sql`excluded.legislation_link`,
                legislationTitle: sql`excluded.legislation_title`,
                difficulty: sql`excluded.difficulty`,
                discipline: sql`excluded.discipline`,
                topic: sql`excluded.topic`,
                examBoard: sql`excluded.exam_board`,
                year: sql`excluded.year`,
                phase: sql`excluded.phase`,
                lastUpdAt: sql`excluded.last_upd_at`,
              },
            });
        }

        return { upserted: rows.length };
      }),
  }),
});
