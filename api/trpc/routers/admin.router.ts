// api/trpc/routers/admin.router.ts
//
// Admin procedures for managing the global oab_questions catalog.
// All routes require users.role === "admin" (adminProcedure).
// Queries hit the raw db client directly — oab_questions is a global table,
// not user-scoped.

import { z } from "zod";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import {
  examCalendarEvents,
  examCalendars,
  oabQuestions,
  spacedRepetitionConfig,
} from "../../../drizzle/schema";
import { adminProcedure, router } from "../procedures";
import { adminQuestionInputSchema } from "../../../shared/domain/admin-question";
import { DEFAULT_SM2_CONFIG } from "../../../shared/domain/spaced-repetition";
import {
  aiExplanationSchema,
  buildExplainVariables,
  parseExplainResponse,
} from "../../../shared/domain/ai-eval";
import { invokeRelay } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";

const calendarEventInput = z.object({
  label: z.string().min(1),
  dateText: z.string().min(1),
  sortOrder: z.number().int().default(0),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const calendarInput = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  events: z.array(calendarEventInput),
});

const sm2ConfigInput = z.object({
  defaultEaseFactor: z.number().min(1).max(5),
  minEaseFactor: z.number().min(1).max(3),
  easeFactorCorrectBonus: z.number().min(0).max(1),
  easeFactorWrongPenalty: z.number().min(0).max(1),
  initialInterval: z.number().int().min(1).max(7),
  secondInterval: z.number().int().min(2).max(60),
});

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
  calendars: router({
    list: adminProcedure.query(async () => {
      const cals = await db
        .select()
        .from(examCalendars)
        .orderBy(asc(examCalendars.sortOrder), asc(examCalendars.createdAt));

      if (cals.length === 0) return [];

      const events = await db
        .select()
        .from(examCalendarEvents)
        .where(
          inArray(
            examCalendarEvents.calendarId,
            cals.map((c) => c.id),
          ),
        )
        .orderBy(asc(examCalendarEvents.sortOrder), asc(examCalendarEvents.createdAt));

      return cals.map((cal) => ({
        ...cal,
        events: events.filter((e) => e.calendarId === cal.id),
      }));
    }),

    create: adminProcedure.input(calendarInput).mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const [cal] = await db
        .insert(examCalendars)
        .values({
          title: input.title,
          note: input.note ?? null,
          active: input.active,
          sortOrder: input.sortOrder,
          createdAt: now,
          lastUpdAt: now,
        })
        .returning({ id: examCalendars.id });
      if (cal === undefined) throw new Error("calendar insert returned no row");

      if (input.events.length > 0) {
        await db.insert(examCalendarEvents).values(
          input.events.map((e) => ({
            calendarId: cal.id,
            label: e.label,
            dateText: e.dateText,
            eventDate: e.eventDate ?? null,
            sortOrder: e.sortOrder,
            createdAt: now,
            lastUpdAt: now,
          })),
        );
      }
      return { id: cal.id };
    }),

    update: adminProcedure
      .input(calendarInput.extend({ id: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const now = new Date().toISOString();
        await db
          .update(examCalendars)
          .set({
            title: input.title,
            note: input.note ?? null,
            active: input.active,
            sortOrder: input.sortOrder,
            lastUpdAt: now,
          })
          .where(eq(examCalendars.id, input.id));

        // Replace all events atomically.
        await db.delete(examCalendarEvents).where(eq(examCalendarEvents.calendarId, input.id));
        if (input.events.length > 0) {
          await db.insert(examCalendarEvents).values(
            input.events.map((e) => ({
              calendarId: input.id,
              label: e.label,
              dateText: e.dateText,
              eventDate: e.eventDate ?? null,
              sortOrder: e.sortOrder,
              createdAt: now,
              lastUpdAt: now,
            })),
          );
        }
        return { ok: true as const };
      }),

    toggleActive: adminProcedure
      .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
      .mutation(async ({ input }) => {
        await db
          .update(examCalendars)
          .set({ active: input.active, lastUpdAt: new Date().toISOString() })
          .where(eq(examCalendars.id, input.id));
        return { ok: true as const };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input }) => {
        await db.delete(examCalendars).where(eq(examCalendars.id, input.id));
        return { ok: true as const };
      }),
  }),

  spacedRepetition: router({
    getConfig: adminProcedure.query(async () => {
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
    }),

    updateConfig: adminProcedure.input(sm2ConfigInput).mutation(async ({ input }) => {
      const now = new Date().toISOString();
      await db
        .insert(spacedRepetitionConfig)
        .values({
          id: "default",
          defaultEaseFactor: input.defaultEaseFactor.toFixed(2),
          minEaseFactor: input.minEaseFactor.toFixed(2),
          easeFactorCorrectBonus: input.easeFactorCorrectBonus.toFixed(2),
          easeFactorWrongPenalty: input.easeFactorWrongPenalty.toFixed(2),
          initialInterval: input.initialInterval,
          secondInterval: input.secondInterval,
          createdAt: now,
          lastUpdAt: now,
        })
        .onConflictDoUpdate({
          target: spacedRepetitionConfig.id,
          set: {
            defaultEaseFactor: input.defaultEaseFactor.toFixed(2),
            minEaseFactor: input.minEaseFactor.toFixed(2),
            easeFactorCorrectBonus: input.easeFactorCorrectBonus.toFixed(2),
            easeFactorWrongPenalty: input.easeFactorWrongPenalty.toFixed(2),
            initialInterval: input.initialInterval,
            secondInterval: input.secondInterval,
            lastUpdAt: now,
          },
        });
      return { ok: true as const };
    }),
  }),

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

    // Generate a 4-pillar explanation via the relay (lexflow-relay → Gemini).
    // Server-owned prompt; returns the parsed explanation for admin review before
    // saveAiExplanation persists it. No DB write here.
    generateExplanation: adminProcedure
      .input(
        z.object({
          questionText: z.string().min(1),
          options: z.array(z.string()).min(2),
          correctAnswer: z.string().min(1),
          legalBasis: z.string().nullable(),
        }),
      )
      .mutation(async ({ input }) => {
        const payload = resolveAiPrompt("oab-explain", buildExplainVariables(input));
        const { text } = await invokeRelay<{ text: string }>(payload);
        const parsed = parseExplainResponse(text);
        if (parsed === null) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: "A IA retornou um formato inesperado. Tente novamente.",
          });
        }
        return parsed;
      }),

    // Persist an admin-reviewed AI explanation for a question. The explanation is
    // generated via generateExplanation and sent here already parsed —
    // client-asserted, Clerk-gated to admin role. Mirrors discursive saveAnswer.
    saveAiExplanation: adminProcedure
      .input(z.object({ id: z.string().min(1), explanation: aiExplanationSchema }))
      .mutation(async ({ input }) => {
        await db
          .update(oabQuestions)
          .set({ aiExplanation: input.explanation, lastUpdAt: new Date().toISOString() })
          .where(eq(oabQuestions.id, input.id));
        return { ok: true as const };
      }),
  }),
});
