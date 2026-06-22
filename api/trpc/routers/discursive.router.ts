// api/trpc/routers/discursive.router.ts
//
// Read + answer access for OAB 2ª-fase (discursive) questions. The catalog
// (oab_discursive_questions) is global; answers (user_discursive_answers) and
// prova runs (discursive_sessions) are per-user and scoped via ctx.db. These
// essays have no options and no text-match grading — the student self-scores
// against the padrão, optionally backed by an AI score.
//
// AI grading: online the browser gets the model's raw text from the central relay
// (task=complete), parses {score, feedback} (shared/domain/ai-eval), and persists
// it via saveAnswer — Clerk-gated through protectedProcedure, exactly like the
// student's own self-score. Locally (no NAT) gradeWithAi calls the model directly
// and persists in one server call.

import { z } from "zod";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import type { ScopedDb } from "../../db/scope";
import {
  appConfig,
  discursiveSessions,
  oabDiscursiveQuestions,
  userDiscursiveAnswers,
} from "../../../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "../procedures";
import { aiConfigured, completeAi } from "../../lib/ai-provider";
import { QUESTION_TYPES } from "../../../shared/domain/discursive-question";
import {
  buildGradeUserMessage,
  DEFAULT_GRADE_SYSTEM_PROMPT,
  GRADE_PROMPT_KEY,
  parseGradeResponse,
} from "../../../shared/domain/ai-eval";

// Catalog fields safe to expose before the student submits — deliberately omits
// modelAnswer + legalBasis (the answer key), which only answerKey() returns.
const catalogColumns = {
  id: oabDiscursiveQuestions.id,
  examLabel: oabDiscursiveQuestions.examLabel,
  examBoard: oabDiscursiveQuestions.examBoard,
  year: oabDiscursiveQuestions.year,
  area: oabDiscursiveQuestions.area,
  questionType: oabDiscursiveQuestions.questionType,
  orderIndex: oabDiscursiveQuestions.orderIndex,
  statement: oabDiscursiveQuestions.statement,
  maxPoints: oabDiscursiveQuestions.maxPoints,
  maxLines: oabDiscursiveQuestions.maxLines,
  topic: oabDiscursiveQuestions.topic,
};

const listInput = z.object({
  area: z.string().min(1).optional(),
  examLabel: z.string().min(1).optional(),
  year: z.number().int().optional(),
  questionType: z.enum(QUESTION_TYPES).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// Persisting one answer: upsert by `answerId` (UPDATE) or create it (INSERT).
// aiScore/aiFeedback are the browser-parsed grade (client-asserted, like selfScore);
// both null ⇒ no grade written this call (e.g. finalizing self-scores at finish).
const saveAnswerInput = z.object({
  answerId: z.string().uuid().optional(),
  questionId: z.string().min(1),
  answerText: z.string().min(1),
  selfScore: z.number().min(0).nullable().default(null),
  timeSpent: z.number().int().min(0).default(0),
  sessionId: z.string().uuid().nullable().default(null),
  aiScore: z.number().min(0).nullable().default(null),
  aiFeedback: z.string().min(1).nullable().default(null),
});

type AiGrade = { aiScore: number; aiFeedback: string };

// Load the answer-key + maxPoints for one question (global catalog).
async function loadQuestion(questionId: string): Promise<{
  statement: string;
  modelAnswer: string | null;
  legalBasis: string | null;
  maxPoints: number;
}> {
  const [q] = await db
    .select({
      statement: oabDiscursiveQuestions.statement,
      modelAnswer: oabDiscursiveQuestions.modelAnswer,
      legalBasis: oabDiscursiveQuestions.legalBasis,
      maxPoints: oabDiscursiveQuestions.maxPoints,
    })
    .from(oabDiscursiveQuestions)
    .where(eq(oabDiscursiveQuestions.id, questionId))
    .limit(1);
  if (q === undefined)
    throw new TRPCError({ code: "NOT_FOUND", message: "Questão não encontrada" });
  return q;
}

// Shared upsert for both the online (saveAnswer) and local-dev (gradeWithAi)
// grade paths. ai_* columns are written only when a grade is supplied; a no-grade
// call (e.g. finalizing an ungraded answer) leaves any existing grade intact.
async function upsertAnswer(
  ctx: { userId: string; db: ScopedDb },
  input: {
    answerId?: string | undefined;
    questionId: string;
    answerText: string;
    selfScore: number | null;
    timeSpent: number;
    sessionId: string | null;
    ai: AiGrade | null;
  },
): Promise<string> {
  const now = sql`now()`;
  if (input.answerId !== undefined) {
    const base = {
      answerText: input.answerText,
      selfScore: input.selfScore,
      timeSpent: input.timeSpent,
      lastUpdAt: now,
      lastUpdBy: ctx.userId,
    };
    const [row] = await db
      .update(userDiscursiveAnswers)
      .set(
        input.ai !== null
          ? { ...base, aiScore: input.ai.aiScore, aiFeedback: input.ai.aiFeedback, aiGradedAt: now }
          : base,
      )
      .where(
        and(eq(userDiscursiveAnswers.id, input.answerId), ctx.db.conditions(userDiscursiveAnswers)),
      )
      .returning({ id: userDiscursiveAnswers.id });
    if (row === undefined)
      throw new TRPCError({ code: "NOT_FOUND", message: "Resposta não encontrada" });
    return row.id;
  }
  const [row] = await db
    .insert(userDiscursiveAnswers)
    .values({
      userId: ctx.userId,
      questionId: input.questionId,
      sessionId: input.sessionId,
      answerText: input.answerText,
      selfScore: input.selfScore,
      timeSpent: input.timeSpent,
      aiScore: input.ai?.aiScore ?? null,
      aiFeedback: input.ai?.aiFeedback ?? null,
      aiGradedAt: input.ai !== null ? now : null,
      createdBy: ctx.userId,
      lastUpdBy: ctx.userId,
    })
    .returning({ id: userDiscursiveAnswers.id });
  if (row === undefined) throw new Error("user_discursive_answers insert returned no row");
  return row.id;
}

export const discursiveRouter = router({
  // Filtered catalog list (single-question practice). Answer key withheld.
  list: protectedProcedure.input(listInput).query(async ({ input }) => {
    const conds: SQL[] = [];
    if (input.area !== undefined) conds.push(eq(oabDiscursiveQuestions.area, input.area));
    if (input.examLabel !== undefined)
      conds.push(eq(oabDiscursiveQuestions.examLabel, input.examLabel));
    if (input.year !== undefined) conds.push(eq(oabDiscursiveQuestions.year, input.year));
    if (input.questionType !== undefined)
      conds.push(eq(oabDiscursiveQuestions.questionType, input.questionType));

    return db
      .select(catalogColumns)
      .from(oabDiscursiveQuestions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(oabDiscursiveQuestions.year), oabDiscursiveQuestions.orderIndex)
      .limit(input.limit);
  }),

  // Distinct provas in the catalog — drives the exam/area/year filter pickers.
  exams: protectedProcedure.query(async () => {
    return db
      .selectDistinct({
        examLabel: oabDiscursiveQuestions.examLabel,
        area: oabDiscursiveQuestions.area,
        year: oabDiscursiveQuestions.year,
      })
      .from(oabDiscursiveQuestions)
      .orderBy(desc(oabDiscursiveQuestions.year), oabDiscursiveQuestions.examLabel);
  }),

  // The full prova (1 peça + 4 discursivas) for one exam/area, ordered. Answer
  // key withheld until the student submits and calls answerKey().
  getProva: protectedProcedure
    .input(
      z.object({ examLabel: z.string().min(1), area: z.string().min(1), year: z.number().int() }),
    )
    .query(async ({ input }) => {
      return db
        .select(catalogColumns)
        .from(oabDiscursiveQuestions)
        .where(
          and(
            eq(oabDiscursiveQuestions.examLabel, input.examLabel),
            eq(oabDiscursiveQuestions.area, input.area),
            eq(oabDiscursiveQuestions.year, input.year),
          ),
        )
        .orderBy(oabDiscursiveQuestions.orderIndex);
    }),

  // Reveal the official padrão + legal basis for answered questions (post-submit).
  answerKey: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(10) }))
    .query(async ({ input }) => {
      return db
        .select({
          id: oabDiscursiveQuestions.id,
          modelAnswer: oabDiscursiveQuestions.modelAnswer,
          legalBasis: oabDiscursiveQuestions.legalBasis,
          maxPoints: oabDiscursiveQuestions.maxPoints,
        })
        .from(oabDiscursiveQuestions)
        .where(inArray(oabDiscursiveQuestions.id, input.ids));
    }),

  // Open a prova session (lazy: created the first time the student grades or
  // finishes a full-prova run). Single-question practice passes no session.
  ensureSession: protectedProcedure
    .input(
      z.object({ examLabel: z.string().min(1), area: z.string().min(1), year: z.number().int() }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .insert(discursiveSessions)
        .values({
          userId: ctx.userId,
          examLabel: input.examLabel,
          area: input.area,
          year: input.year,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .returning({ id: discursiveSessions.id });
      if (row === undefined) throw new Error("discursive_session insert returned no row");
      return { sessionId: row.id };
    }),

  // Persist (or update) one answer, optionally with its AI grade. Client-asserted
  // (like the self-score) and Clerk-gated via protectedProcedure — the browser
  // parses {score, feedback} from the relay's text and sends them here.
  saveAnswer: protectedProcedure.input(saveAnswerInput).mutation(async ({ ctx, input }) => {
    const ai: AiGrade | null =
      input.aiScore !== null && input.aiFeedback !== null
        ? { aiScore: input.aiScore, aiFeedback: input.aiFeedback }
        : null;
    const answerId = await upsertAnswer(ctx, {
      answerId: input.answerId,
      questionId: input.questionId,
      answerText: input.answerText,
      selfScore: input.selfScore,
      timeSpent: input.timeSpent,
      sessionId: input.sessionId,
      ai,
    });
    return { answerId, aiScore: ai?.aiScore ?? null, aiFeedback: ai?.aiFeedback ?? null };
  }),

  // Close a prova session (endedAt + total self-score, computed client-side from
  // the per-item self-scores). No-op-safe if called twice.
  finalizeSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        totalSelfScore: z.number().min(0).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(discursiveSessions)
        .set({
          endedAt: sql`now()`,
          totalSelfScore: input.totalSelfScore,
          lastUpdAt: sql`now()`,
          lastUpdBy: ctx.userId,
        })
        .where(
          and(eq(discursiveSessions.id, input.sessionId), ctx.db.conditions(discursiveSessions)),
        );
      return { ok: true as const };
    }),

  // The effective AI grading prompt — the editable app_config override if set,
  // else the code default. The browser sends this as the `system` half to the relay.
  gradingPrompt: protectedProcedure.query(async () => {
    const [row] = await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, GRADE_PROMPT_KEY))
      .limit(1);
    return { prompt: row?.value ?? DEFAULT_GRADE_SYSTEM_PROMPT };
  }),

  // Admin-only: override the grading prompt at runtime (no deploy). Empty string
  // resets to the code default (delete the row).
  setGradingPrompt: adminProcedure
    .input(z.object({ prompt: z.string().max(20000) }))
    .mutation(async ({ ctx, input }) => {
      if (input.prompt.trim().length === 0) {
        await db.delete(appConfig).where(eq(appConfig.key, GRADE_PROMPT_KEY));
        return { ok: true as const };
      }
      await db
        .insert(appConfig)
        .values({
          key: GRADE_PROMPT_KEY,
          value: input.prompt,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: appConfig.key,
          set: { value: input.prompt, lastUpdAt: sql`now()`, lastUpdBy: ctx.userId },
        });
      return { ok: true as const };
    }),

  // Whether AI grading is configured (a key is present) — gates the UI button.
  aiAvailable: protectedProcedure.query(() => ({ available: aiConfigured() })),

  // Grade one answer with AI AND persist it (local-dev path). lexflow calls the
  // model directly here, so it is the trusted server — no relay signature needed.
  // NOTE: the deployed Lambda has no NAT, so the outbound call fails in prod;
  // online grading goes browser → relay → saveAnswer (signed). Mirrors saveAnswer's
  // upsert so dev exercises the same "grade persists immediately" behaviour.
  gradeWithAi: protectedProcedure
    .input(
      z.object({
        questionId: z.string().min(1),
        answerText: z.string().min(1),
        answerId: z.string().uuid().optional(),
        sessionId: z.string().uuid().nullable().default(null),
        selfScore: z.number().min(0).nullable().default(null),
        timeSpent: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const q = await loadQuestion(input.questionId);
      const [cfg] = await db
        .select({ value: appConfig.value })
        .from(appConfig)
        .where(eq(appConfig.key, GRADE_PROMPT_KEY))
        .limit(1);
      const system = cfg?.value ?? DEFAULT_GRADE_SYSTEM_PROMPT;
      const user = buildGradeUserMessage({
        statement: q.statement,
        studentAnswer: input.answerText,
        modelAnswer: q.modelAnswer,
        legalBasis: q.legalBasis,
        maxPoints: q.maxPoints,
      });

      const text = await completeAi({ system, user, json: true });
      const parsed = parseGradeResponse(text, q.maxPoints);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não foi possível interpretar a avaliação da IA",
        });
      }
      const answerId = await upsertAnswer(ctx, {
        answerId: input.answerId,
        questionId: input.questionId,
        answerText: input.answerText,
        selfScore: input.selfScore,
        timeSpent: input.timeSpent,
        sessionId: input.sessionId,
        ai: { aiScore: parsed.score, aiFeedback: parsed.feedback },
      });
      return { score: parsed.score, feedback: parsed.feedback, answerId };
    }),

  // Recent answers with their question context — for the history tab.
  listAttempts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      return db
        .select({
          id: userDiscursiveAnswers.id,
          questionId: userDiscursiveAnswers.questionId,
          sessionId: userDiscursiveAnswers.sessionId,
          answerText: userDiscursiveAnswers.answerText,
          selfScore: userDiscursiveAnswers.selfScore,
          aiScore: userDiscursiveAnswers.aiScore,
          createdAt: userDiscursiveAnswers.createdAt,
          area: oabDiscursiveQuestions.area,
          topic: oabDiscursiveQuestions.topic,
          questionType: oabDiscursiveQuestions.questionType,
          maxPoints: oabDiscursiveQuestions.maxPoints,
        })
        .from(userDiscursiveAnswers)
        .innerJoin(
          oabDiscursiveQuestions,
          eq(userDiscursiveAnswers.questionId, oabDiscursiveQuestions.id),
        )
        .where(ctx.db.conditions(userDiscursiveAnswers))
        .orderBy(desc(userDiscursiveAnswers.createdAt))
        .limit(input.limit);
    }),

  // Recent prova runs (full-exam sessions).
  recentSessions: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(discursiveSessions)
      .where(ctx.db.conditions(discursiveSessions))
      .orderBy(desc(discursiveSessions.createdAt))
      .limit(10);
  }),

  // On-read summary: how many answered/graded and average score as a percentage
  // of the questions' max points (computed like stats.router, no stored table).
  stats: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        totalAnswered: sql<number>`count(*)::int`,
        totalGraded: sql<number>`count(${userDiscursiveAnswers.selfScore})::int`,
        avgScorePct: sql<number>`coalesce(round(avg(${userDiscursiveAnswers.selfScore} / nullif(${oabDiscursiveQuestions.maxPoints}, 0)) * 100), 0)::int`,
      })
      .from(userDiscursiveAnswers)
      .innerJoin(
        oabDiscursiveQuestions,
        eq(userDiscursiveAnswers.questionId, oabDiscursiveQuestions.id),
      )
      .where(ctx.db.conditions(userDiscursiveAnswers));
    return {
      totalAnswered: row?.totalAnswered ?? 0,
      totalGraded: row?.totalGraded ?? 0,
      avgScorePct: row?.avgScorePct ?? 0,
    };
  }),
});
