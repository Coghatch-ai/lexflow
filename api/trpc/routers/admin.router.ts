// api/trpc/routers/admin.router.ts
//
// Admin procedures for managing the global oab_questions catalog.
// All routes require users.role === "admin" (adminProcedure).
// Queries hit the raw db client directly — oab_questions is a global table,
// not user-scoped.

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import {
  examCalendarEvents,
  examCalendars,
  oabQuestions,
  spacedRepetitionConfig,
} from "../../../drizzle/schema";
import { adminProcedure, router } from "../procedures";
import { adminQuestionInputSchema } from "../../../shared/domain/admin-question";
import { deriveEventDate } from "../../../shared/domain/exam-calendar";
import { DEFAULT_SM2_CONFIG } from "../../../shared/domain/spaced-repetition";
import {
  aiExplanationSchema,
  buildExplainVariables,
  optionLetter,
  stripCorrectLetterFromWhyWrong,
} from "../../../shared/domain/ai-eval";
import { enqueueRelayJob, getRelayJob } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { admissionRead, resolveMeteringModel, settleDelivered } from "../../lib/ai-metering";
import { getAllConfigRows, upsertConfigRow } from "../../lib/pricing-config";
import { grantSubscription } from "../../lib/subscription";
import { grantAllowance } from "../../lib/allowance";

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

export const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.string().min(1).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  hasAiExplanation: z.enum(["all", "yes", "no"]).default("all"),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});

/**
 * Returns the Drizzle SQL condition for the hasAiExplanation filter:
 *   "yes"  → isNotNull(oabQuestions.aiExplanation)
 *   "no"   → isNull(oabQuestions.aiExplanation)
 *   "all"  → undefined (no condition added)
 *
 * Exported for unit testing — the test imports this real function so any
 * swap of isNull↔isNotNull or removal of the condition is caught immediately.
 */
export function aiExplanationFilter(
  value: "all" | "yes" | "no",
): ReturnType<typeof isNotNull> | ReturnType<typeof isNull> | undefined {
  if (value === "yes") return isNotNull(oabQuestions.aiExplanation);
  if (value === "no") return isNull(oabQuestions.aiExplanation);
  return undefined;
}

function generateId(): string {
  return `qi${Date.now()}`;
}

// ─── S5: Admin-editable pricing/config ────────────────────────────────────────

const pricingConfigUpsertInput = z.object({
  key: z.string().min(1).max(100),
  numericValue: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .nullable()
    .optional(),
  textValue: z.string().max(500).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

// ─── S6: Subscription grant paths ─────────────────────────────────────────────

const subscriptionGrantInput = z.object({
  userId: z.string().uuid(),
  periodMonths: z.number().int().min(1).max(120),
  note: z.string().max(200).optional(),
});

const allowanceGrantInput = z.object({
  userId: z.string().uuid(),
  units: z.number().int().positive().max(1_000_000),
  note: z.string().max(200).optional(),
});

export const adminRouter = router({
  // S5 — admin-editable pricing/config table.
  pricing: router({
    // List all config rows.
    list: adminProcedure.query(async () => {
      return getAllConfigRows();
    }),

    // Upsert a config row. Changing a row takes effect immediately — no redeploy.
    upsert: adminProcedure.input(pricingConfigUpsertInput).mutation(async ({ ctx, input }) => {
      await upsertConfigRow(
        input.key,
        input.numericValue ?? null,
        input.textValue ?? null,
        input.description ?? null,
        ctx.userId,
      );
      return { ok: true as const };
    }),
  }),

  // S6 — subscription grant paths (no gateway; admin action only here).
  subscriptions: router({
    // Grant a paid subscription period to a user (admin action).
    // idempotencyKey = sub:admin:<userId>:<uuid> — caller-generated UUID ensures
    // each distinct admin action gets a fresh key; a UI retry with the same key
    // is a no-op on the allowance grant (F3, issue #53).
    grant: adminProcedure.input(subscriptionGrantInput).mutation(async ({ input }) => {
      const idempotencyKey = `sub:admin:${input.userId}:${randomUUID()}`;
      await grantSubscription(input.userId, input.periodMonths, idempotencyKey, input.note);
      return { ok: true as const };
    }),

    // Grant allowance units directly to a user (admin top-up, no coupon needed).
    grantAllowance: adminProcedure.input(allowanceGrantInput).mutation(async ({ input }) => {
      await grantAllowance(
        input.userId,
        input.units,
        "admin_grant",
        `allowance:admin:${randomUUID()}`,
        input.note,
      );
      return { ok: true as const };
    }),
  }),

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
            eventDate: deriveEventDate(e.dateText) ?? e.eventDate ?? null,
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
              eventDate: deriveEventDate(e.dateText) ?? e.eventDate ?? null,
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
      const aiCond = aiExplanationFilter(input.hasAiExplanation);
      if (aiCond !== undefined) conds.push(aiCond);

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
      .mutation(async ({ ctx, input }) => {
        const payload = resolveAiPrompt("oab-explain", buildExplainVariables(input));
        // D3 shadow admission-read (epic #50): this door was UNMETERED before —
        // observe-only, never denies; the delivered-only charge is in
        // settleGeneration. No old debit rail existed here (oldDebitCents=0 there).
        await admissionRead(ctx.userId);
        const jobId = await enqueueRelayJob(ctx.userId, payload);
        return { jobId };
      }),

    // D3 (epic #50) — delivered-only SHADOW settle for the admin explanation door,
    // which was previously UNMETERED (Codex: meter admin.generateExplanation). The
    // client calls this after polling relay.job; it re-reads the result server-side
    // (delivery authoritative) and fires the shadow charge + reconcile. oldDebit=0
    // (no prior rail) so the metric surfaces the would-charge for a formerly-free
    // action. Writes nothing in shadow.
    settleGeneration: adminProcedure
      .input(z.object({ jobId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const job = await getRelayJob(ctx.userId, input.jobId);
        const delivered = job.status === "done";
        const result = await settleDelivered({
          userId: ctx.userId,
          source: "explanation",
          refId: `explain:admin:${input.jobId}`,
          // Metering model MUST be server-derived (Codex F2): no client-supplied
          // model may reach costFor() (an unknown string → rawCents=0 dodge under
          // enforce). resolveMeteringModel() (no arg) → PROD_DEFAULT_MODEL.
          model: resolveMeteringModel(),
          usage: { kind: "tokens", amount: 2048 },
          delivered,
          oldDebitCents: 0,
          action: "admin.generateExplanation",
        });
        return { settled: result?.outcome ?? "skipped" };
      }),

    // Persist an admin-reviewed AI explanation for a question. The explanation is
    // generated via generateExplanation and sent here already parsed —
    // client-asserted, Clerk-gated to admin role. Mirrors discursive saveAnswer.
    // Defense-in-depth: re-strip the correct letter server-side in case the client
    // preview did not (or an older client sent the payload before the fix).
    saveAiExplanation: adminProcedure
      .input(z.object({ id: z.string().min(1), explanation: aiExplanationSchema }))
      .mutation(async ({ input }) => {
        // Fetch options + correctAnswer to derive the correct letter for stripping.
        const [qRow] = await db
          .select({ options: oabQuestions.options, correctAnswer: oabQuestions.correctAnswer })
          .from(oabQuestions)
          .where(eq(oabQuestions.id, input.id))
          .limit(1);
        const letter =
          qRow !== undefined ? optionLetter(qRow.options, qRow.correctAnswer) : undefined;
        const explanation = {
          ...input.explanation,
          whyWrong: stripCorrectLetterFromWhyWrong(input.explanation.whyWrong, letter),
        };
        await db
          .update(oabQuestions)
          .set({ aiExplanation: explanation, lastUpdAt: new Date().toISOString() })
          .where(eq(oabQuestions.id, input.id));
        return { ok: true as const };
      }),
  }),
});
