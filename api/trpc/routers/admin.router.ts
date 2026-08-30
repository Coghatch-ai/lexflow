// api/trpc/routers/admin.router.ts
//
// Admin procedures for managing the global oab_questions catalog.
// All routes require users.role === "admin" (adminProcedure).
// Queries hit the raw db client directly — oab_questions is a global table,
// not user-scoped.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
  parseExplainResponse,
  stripCorrectLetterFromWhyWrong,
} from "../../../shared/domain/ai-eval";
import { enqueueRelayJob, getRelayJob } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { admit } from "../../lib/admission";
import { parseAiResult, meteringOf, consumeAndCharge } from "../../lib/ai-metering";
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
        // Admission: DENY at balance <= 0 (grace-at-zero). Fail-closed burst on read
        // fail. Charge settles SERVER-SIDE on the consume/persist path
        // (saveAiExplanation, keyed refId `explain:admin:<jobId>`) — NOT a separate
        // client proc, so a delivered explanation cannot be saved without a charge.
        await admit(ctx.userId);
        const jobId = await enqueueRelayJob(ctx.userId, payload);
        return { jobId };
      }),

    // Persist an admin explanation for a question. TWO explicit paths (Codex #61
    // round 3): AI-generated persistence is the DEFAULT and is fully server-verified,
    // NEVER client-asserted; a manual edit is a SEPARATE explicit `manual: true` path
    // that cannot carry generated output through an unbilled route.
    //
    // AI path (manual !== true — REQUIRES a jobId): the explanation text is DERIVED
    // SERVER-SIDE from the relay job (client-sent `explanation` is IGNORED so it can
    // neither forge the text nor skip the charge). We re-read the job (scoped to
    // ctx.userId → a foreign job is pending/NOT-FOUND here), REQUIRE it be `done`
    // BEFORE any write, parse the explanation from the relay result, strip the correct
    // letter, persist, then settle `explain:admin:<jobId>` (delivered=true, idempotent
    // by refId). A missing/random/pending jobId → reject, NOTHING persisted, NO charge.
    //
    // Manual path (manual === true, no jobId): an admin-authored edit — persists the
    // client `explanation` (admin-role gated) with NO relay read and NO settle. It is
    // opt-in and explicit, so it can never be the accidental unbilled route for freshly
    // generated output (that route now requires a verified done job + always charges).
    saveAiExplanation: adminProcedure
      .input(
        z.object({
          id: z.string().min(1),
          explanation: aiExplanationSchema,
          jobId: z.string().uuid().optional(),
          manual: z.literal(true).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Fetch options + correctAnswer to derive the correct letter for stripping.
        const [qRow] = await db
          .select({ options: oabQuestions.options, correctAnswer: oabQuestions.correctAnswer })
          .from(oabQuestions)
          .where(eq(oabQuestions.id, input.id))
          .limit(1);
        const letter =
          qRow !== undefined ? optionLetter(qRow.options, qRow.correctAnswer) : undefined;

        // MANUAL EDIT — explicit, admin-authored, no AI delivery/charge.
        if (input.manual === true) {
          const explanation = {
            ...input.explanation,
            whyWrong: stripCorrectLetterFromWhyWrong(input.explanation.whyWrong, letter),
          };
          await db
            .update(oabQuestions)
            .set({ aiExplanation: explanation, lastUpdAt: new Date().toISOString() })
            .where(eq(oabQuestions.id, input.id));
          return { ok: true as const };
        }

        // AI-GENERATED PATH — jobId REQUIRED; explanation is server-derived + charged.
        if (input.jobId === undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "jobId obrigatório para salvar explicação gerada por IA",
          });
        }
        const job = await getRelayJob(ctx.userId, input.jobId);
        if (job.status === "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A geração ainda está em andamento",
          });
        }
        if (job.status === "error") {
          throw new TRPCError({ code: "BAD_GATEWAY", message: job.error });
        }
        // Parse OUTSIDE the transaction: text + the REAL metering facts (#98).
        const ai = parseAiResult(job.data);
        const derived = parseExplainResponse(ai.text, letter);
        if (derived === null) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: "A IA retornou um formato inesperado",
          });
        }
        // ATOMIC persist + single-use consume + charge (Codex #61 round 3). The
        // consume marker + charge + aiExplanation UPDATE run in ONE transaction, so a
        // persisted explanation can never outlive its charge. The marker is BOUND to
        // this question (input.id): a replay of the same jobId onto a DIFFERENT
        // question is REJECTED (CONFLICT); onto the SAME question it is an idempotent
        // no-op (persist + charge already committed once). refId `explain:admin:<jobId>`
        // is shared by the marker (PK) and charge().
        const jobId = input.jobId;
        await db.transaction(async (tx) => {
          const outcome = await consumeAndCharge({
            tx,
            userId: ctx.userId,
            jobId,
            targetId: input.id,
            source: "explanation",
            refId: `explain:admin:${jobId}`,
            // Metering facts are SERVER-READ from the relay result, never the input.
            metering: meteringOf(ai),
          });
          if (outcome === "replay") return; // already consumed onto this question.
          await tx
            .update(oabQuestions)
            .set({ aiExplanation: derived, lastUpdAt: new Date().toISOString() })
            .where(eq(oabQuestions.id, input.id));
        });
        return { ok: true as const };
      }),
  }),
});
