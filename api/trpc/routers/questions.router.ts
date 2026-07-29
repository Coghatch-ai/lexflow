// api/trpc/routers/questions.router.ts
//
// Read access to the global oab_questions catalog + the per-user "review queue"
// (questions the signed-in user has gotten wrong). Gated behind auth.

import { z } from "zod";
import { and, eq, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import {
  oabQuestions,
  spacedRepetitionConfig,
  userAnswers,
  userQuestionStates,
} from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { DEFAULT_SM2_CONFIG } from "../../../shared/domain/spaced-repetition";
import {
  buildExplainVariables,
  optionLetter,
  parseExplainResponse,
} from "../../../shared/domain/ai-eval";
import { enqueueRelayJob, getRelayJob, mintJobId } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { admit } from "../../lib/admission";
import { resolveMeteringModel, consumeAndCharge } from "../../lib/ai-metering";

// Output contract for focusedDrill — kept a single explicit shape (see note on
// the procedure).
type FocusedDrill = {
  available: boolean;
  weakestDiscipline: string | null;
  weakestAccuracy: number | null;
  recurringCount: number;
  questions: (typeof oabQuestions.$inferSelect)[];
};

const listInput = z.object({
  discipline: z.string().min(1).optional(),
  examBoard: z.enum(["FGV", "CESPE"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  phase: z.enum(["1st", "2nd"]).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const questionsRouter = router({
  list: protectedProcedure.input(listInput).query(async ({ input }) => {
    const conds: SQL[] = [];
    if (input.discipline !== undefined) conds.push(eq(oabQuestions.discipline, input.discipline));
    if (input.examBoard !== undefined) conds.push(eq(oabQuestions.examBoard, input.examBoard));
    if (input.difficulty !== undefined) conds.push(eq(oabQuestions.difficulty, input.difficulty));
    if (input.phase !== undefined) conds.push(eq(oabQuestions.phase, input.phase));

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

  // Questions due for SM-2 review (next_review_at <= now). Ordered most-overdue first.
  reviewQueue: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: oabQuestions.id,
        questionText: oabQuestions.questionText,
        options: oabQuestions.options,
        correctAnswer: oabQuestions.correctAnswer,
        explanation: oabQuestions.explanation,
        aiExplanation: oabQuestions.aiExplanation,
        discipline: oabQuestions.discipline,
        examBoard: oabQuestions.examBoard,
        difficulty: oabQuestions.difficulty,
        legalBasis: oabQuestions.legalBasis,
        legislationTitle: oabQuestions.legislationTitle,
        interval: userQuestionStates.interval,
        repetitions: userQuestionStates.repetitions,
        easeFactor: userQuestionStates.easeFactor,
        nextReviewAt: userQuestionStates.nextReviewAt,
        lastCorrect: userQuestionStates.lastCorrect,
      })
      .from(userQuestionStates)
      .innerJoin(oabQuestions, eq(userQuestionStates.questionId, oabQuestions.id))
      .where(
        and(
          eq(userQuestionStates.userId, ctx.userId),
          lte(userQuestionStates.nextReviewAt, sql`now()`),
        ),
      )
      .orderBy(userQuestionStates.nextReviewAt)
      .limit(20);
  }),

  // Count of questions with next_review_at <= now — for the dashboard badge.
  dueCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userQuestionStates)
      .where(
        and(
          eq(userQuestionStates.userId, ctx.userId),
          lte(userQuestionStates.nextReviewAt, sql`now()`),
        ),
      );
    return { count: row?.count ?? 0 };
  }),

  // "Treino focado": a weakness-targeted drill assembled deterministically from
  // the REAL bank (no LLM) — recurring-error questions first, topped up with
  // random questions from the student's weakest discipline. This is the
  // "helps those who fail" remediation loop: error data → targeted practice.
  // Explicit return type: a single shape (no union) so the client keeps the
  // nullable fields (union inference through tRPC stripped the nulls).
  focusedDrill: protectedProcedure.query(async ({ ctx }): Promise<FocusedDrill> => {
    // Weakest discipline with a meaningful sample (≥5 answered).
    const [weakest] = await db
      .select({
        discipline: oabQuestions.discipline,
        accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
      })
      .from(userAnswers)
      .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(oabQuestions.discipline)
      .having(sql`count(*) >= 5`)
      .orderBy(sql`2 asc`)
      .limit(1);

    // Questions the student keeps getting wrong (≥2 answered, ≥2 wrong).
    const recurringIds = await db
      .select({ questionId: userAnswers.questionId })
      .from(userAnswers)
      .where(eq(userAnswers.userId, ctx.userId))
      .groupBy(userAnswers.questionId)
      .having(sql`count(*) >= 2 and sum(case when ${userAnswers.correct} then 0 else 1 end) >= 2`)
      .orderBy(sql`max(${userAnswers.createdAt}) desc`)
      .limit(6);
    const ids = recurringIds.map((r) => r.questionId);
    const recurring =
      ids.length > 0
        ? await db.select().from(oabQuestions).where(inArray(oabQuestions.id, ids))
        : [];

    const weakestDiscipline: string | null = weakest?.discipline ?? null;
    const weakestAccuracy: number | null = weakest?.accuracy ?? null;

    if (weakest === undefined && recurring.length === 0) {
      return {
        available: false,
        weakestDiscipline,
        weakestAccuracy,
        recurringCount: 0,
        questions: [],
      };
    }

    // Top up to 10 from the weakest discipline (falling back to any discipline).
    const fillConds: SQL[] = [];
    if (weakest !== undefined) fillConds.push(eq(oabQuestions.discipline, weakest.discipline));
    const picked = recurring.map((q) => q.id);
    if (picked.length > 0) fillConds.push(notInArray(oabQuestions.id, picked));
    const filler = await db
      .select()
      .from(oabQuestions)
      .where(fillConds.length > 0 ? and(...fillConds) : undefined)
      .orderBy(sql`random()`)
      .limit(Math.max(0, 10 - recurring.length));

    return {
      available: true,
      weakestDiscipline,
      weakestAccuracy,
      recurringCount: recurring.length,
      questions: [...recurring, ...filler],
    };
  }),

  // Fetch a specific set of questions by ID — used by the "Questões Salvas" page.
  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(500) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      return db.select().from(oabQuestions).where(inArray(oabQuestions.id, input.ids));
    }),

  // Public SM-2 config (readable by all authenticated users for display purposes).
  sm2Config: protectedProcedure.query(async () => {
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

  // Get-or-generate a 4-pillar AI explanation for any 1ª-fase question.
  // Available to all signed-in students (protectedProcedure, not admin-only).
  // Returns the cached global explanation immediately when present; otherwise
  // enqueues generation via the relay — the result is written back to the global
  // oab_questions.ai_explanation column (same global cache as admin generateExplanation,
  // no per-user scope, no TABLE_SCOPE change needed).
  getOrGenerateExplanation: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select({
          id: oabQuestions.id,
          questionText: oabQuestions.questionText,
          options: oabQuestions.options,
          correctAnswer: oabQuestions.correctAnswer,
          legalBasis: oabQuestions.legalBasis,
          aiExplanation: oabQuestions.aiExplanation,
        })
        .from(oabQuestions)
        .where(eq(oabQuestions.id, input.id))
        .limit(1);

      if (row === undefined) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "NOT_FOUND", message: "Questão não encontrada" });
      }

      // Cache hit — CORE action is FREE when cached (no LLM call → no allowance debit).
      if (row.aiExplanation !== null) {
        return { cached: true as const, explanation: row.aiExplanation, jobId: null };
      }

      // Cache miss — live LLM call. Admission reads the unified balance
      // (grace-at-zero, fail-closed burst). Nothing is spent at enqueue — the charge
      // settles post-delivery in finalizeExplanation (an undelivered job is never
      // charged), so there is no debit/refund dance.
      const payload = resolveAiPrompt(
        "oab-explain",
        buildExplainVariables({
          questionText: row.questionText,
          options: row.options,
          correctAnswer: row.correctAnswer,
          legalBasis: row.legalBasis ?? null,
        }),
      );
      await admit(ctx.userId);
      const jobId = mintJobId();
      await enqueueRelayJob(ctx.userId, payload, jobId);
      return { cached: false as const, explanation: null, jobId };
    }),

  // Persist an AI explanation generated via getOrGenerateExplanation.
  // The explanation text is NEVER accepted from the client — this procedure
  // re-reads the relay result server-side (keyed by ctx.userId + jobId) and
  // validates it before writing to the global oab_questions.ai_explanation.
  // Idempotent: re-running overwrites the same global cell with relay-authored text.
  // NO TABLE_SCOPE change needed — oab_questions is the global catalog (not per-user).
  finalizeExplanation: protectedProcedure
    .input(z.object({ id: z.string().min(1), jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      if (job.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A geração ainda está em andamento" });
      }
      if (job.status === "error") {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: job.error,
        });
      }
      const raw = job.data as { text: string };

      // Fetch options + correctAnswer to derive the correct letter for stripping.
      const [qRow] = await db
        .select({ options: oabQuestions.options, correctAnswer: oabQuestions.correctAnswer })
        .from(oabQuestions)
        .where(eq(oabQuestions.id, input.id))
        .limit(1);
      const letter =
        qRow !== undefined ? optionLetter(qRow.options, qRow.correctAnswer) : undefined;

      const parsed = parseExplainResponse(raw.text, letter);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "A IA retornou um formato inesperado",
        });
      }
      // ATOMIC persist + single-use consume + charge (Codex #61 round 4). The consume
      // marker + charge + aiExplanation UPDATE all run in ONE transaction: they commit
      // together or roll back together, so a persisted explanation can never outlive its
      // charge. The marker is BOUND to input.id (the explained question): a replay of the
      // same jobId onto a DIFFERENT question is REJECTED (CONFLICT); onto the SAME
      // question it is an idempotent no-op (persist + charge already committed once). refId
      // `explain:<jobId>` is shared by the marker (PK) and charge(). oab_questions is the
      // global catalog (not per-user) — no TABLE_SCOPE change needed here.
      await db.transaction(async (tx) => {
        const outcome = await consumeAndCharge({
          tx,
          userId: ctx.userId,
          jobId: input.jobId,
          targetId: input.id,
          source: "explanation",
          refId: `explain:${input.jobId}`,
          // Metering model MUST be server-derived: a client-supplied model would let an
          // unknown string force rawCents=0 (costFor→0) and dodge the charge.
          model: resolveMeteringModel(),
          usage: { kind: "tokens", amount: 2048 },
        });
        if (outcome === "replay") return; // already consumed onto this question.
        await tx
          .update(oabQuestions)
          .set({ aiExplanation: parsed, lastUpdAt: new Date().toISOString() })
          .where(eq(oabQuestions.id, input.id));
      });
      return { explanation: parsed };
    }),
});
