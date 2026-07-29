// api/trpc/routers/discursive.router.ts
//
// Read + answer access for OAB 2ª-fase (discursive) questions. The catalog
// (oab_discursive_questions) is global; answers (user_discursive_answers) and
// prova runs (discursive_sessions) are per-user and scoped via ctx.db. These
// essays have no options and no text-match grading — the student self-scores
// against the padrão, optionally backed by an AI score.
//
// AI grading: the browser sends { promptId, variables } to the central relay
// (task=complete), parses {score, feedback} (shared/domain/ai-eval), and persists
// it via saveAnswer — Clerk-gated through protectedProcedure, exactly like the
// student's own self-score. The relay owns the system prompt and user template.

import { z } from "zod";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../db/client";
import type { ScopedDb } from "../../db/scope";
import {
  discursiveSessions,
  oabDiscursiveQuestions,
  userDiscursiveAnswers,
} from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import { QUESTION_TYPES } from "../../../shared/domain/discursive-question";
import { getRelayJob } from "../../lib/relay";
import { resolveMeteringModel, consumeAndCharge } from "../../lib/ai-metering";
import type { CreditTx } from "../../lib/credit-charge";
import { parseGradeResponse } from "../../../shared/domain/ai-eval";

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
//
// AI GRADE IS SERVER-DERIVED, NEVER CLIENT-ASSERTED (Codex #61 round 3). The client
// NEVER sends aiScore/aiFeedback — those are the trust hole (a client could forge the
// grade or omit it to persist AI output while dodging the charge). Instead, when an AI
// grade rides on this call the client sends ONLY the `gradeJobId` that produced it;
// saveAnswer re-reads that relay job SERVER-SIDE, requires it be `done` and owned by
// ctx.userId, parses {score,feedback} from the relay result itself, and only then
// persists + settles (refId `grade:<gradeJobId>`). A jobless save is MANUAL only
// (self-score / finalize) and can carry NO AI grade at all — so a delivered grade can
// never be persisted without a verified job AND its charge.
const saveAnswerInput = z.object({
  answerId: z.string().uuid().optional(),
  questionId: z.string().min(1),
  answerText: z.string().min(1),
  selfScore: z.number().min(0).nullable().default(null),
  timeSpent: z.number().int().min(0).default(0),
  sessionId: z.string().uuid().nullable().default(null),
  // Present ⇒ an AI grade rides on this call: server re-reads the job, derives the
  // grade from the relay result, and charges `grade:<gradeJobId>`. Absent ⇒ a manual
  // save (no AI fields are accepted or written on this path).
  gradeJobId: z.string().uuid().optional(),
});

type AiGrade = { aiScore: number; aiFeedback: string };

// The transaction executor upsertAnswer writes through. The AI-graded path passes
// its open tx so the persist joins the consume-marker + charge in ONE atomic unit
// (Codex #61 round 3); the manual path passes the plain db handle.
type Exec = CreditTx | typeof db;

// Upsert one user answer. ai_* columns are written only when a grade is supplied;
// a no-grade call (e.g. finalizing an ungraded answer) leaves any existing grade intact.
async function upsertAnswer(
  exec: Exec,
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
    const [row] = await exec
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
  const [row] = await exec
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
  //
  // AUTHORITATIVE grade settlement lives HERE (Codex #61): when a gradeJobId rides
  // on the call, we re-read the relay result SERVER-SIDE (delivery authoritative,
  // never client-asserted) and fire the money-core charge keyed by `grade:<jobId>`.
  // This is the consume/persist proc the client MUST call — so a delivered grade
  // can never be persisted without being charged, and there is no separate optional
  // settle proc. Idempotent by refId: a double-persist of the same jobId charges
  // exactly once (credit_charges ON CONFLICT). The consume marker + charge + persist
  // commit in ONE tx via consumeAndCharge, so persist can never outlive its charge.
  saveAnswer: protectedProcedure.input(saveAnswerInput).mutation(async ({ ctx, input }) => {
    // No gradeJobId ⇒ MANUAL save (self-score / finalize). No AI grade is derived or
    // written on this path — the ai_* columns stay untouched (upsert `ai: null`).
    if (input.gradeJobId === undefined) {
      const answerId = await upsertAnswer(db, ctx, {
        answerId: input.answerId,
        questionId: input.questionId,
        answerText: input.answerText,
        selfScore: input.selfScore,
        timeSpent: input.timeSpent,
        sessionId: input.sessionId,
        ai: null,
      });
      return { answerId, aiScore: null, aiFeedback: null };
    }

    // AI-graded save: the grade is SERVER-DERIVED from the relay job, NEVER trusted
    // from the client. Re-read the job (scoped to ctx.userId, so a foreign job is
    // pending/NOT-FOUND here) and REQUIRE it be `done` before anything is persisted.
    // A missing/random/pending jobId → reject with NO AI fields written and NO charge.
    const job = await getRelayJob(ctx.userId, input.gradeJobId);
    if (job.status === "pending") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A avaliação ainda está em andamento" });
    }
    if (job.status === "error") {
      throw new TRPCError({ code: "BAD_GATEWAY", message: job.error });
    }
    // maxPoints bounds the derived score (parseGradeResponse clamps to it).
    const [q] = await db
      .select({ maxPoints: oabDiscursiveQuestions.maxPoints })
      .from(oabDiscursiveQuestions)
      .where(eq(oabDiscursiveQuestions.id, input.questionId))
      .limit(1);
    if (q === undefined) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Questão não encontrada" });
    }
    const raw = job.data as { text: string };
    const graded = parseGradeResponse(raw.text, q.maxPoints);
    if (graded === null) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: "A IA retornou um formato inesperado" });
    }
    const ai: AiGrade = { aiScore: graded.score, aiFeedback: graded.feedback };

    // ATOMIC persist + single-use consume + charge (Codex #61 round 3). The consume
    // marker + charge + AI-field persist all run in ONE transaction: they commit
    // together or roll back together, so a persisted grade can never outlive its
    // charge. The marker is BOUND to questionId (the grade's stable target): a replay
    // of the same gradeJobId onto a DIFFERENT question is REJECTED (CONFLICT); onto
    // the SAME question it is an idempotent no-op (persist + charge already committed
    // once). refId `grade:<jobId>` is shared by the marker (PK) and charge().
    const gradeJobId = input.gradeJobId;
    const refId = `grade:${gradeJobId}`;
    const answerId = await db.transaction(async (tx) => {
      const outcome = await consumeAndCharge({
        tx,
        userId: ctx.userId,
        jobId: gradeJobId,
        targetId: input.questionId,
        source: "grade",
        refId,
        // Metering model MUST be server-derived: a client-supplied model would let
        // an unknown string force rawCents=0 (costFor→0) and dodge the charge.
        model: resolveMeteringModel(),
        // Grade output is the graded feedback (JSON) — meter on the prompt's output
        // budget as a stable per-action usage proxy until real token counts flow.
        usage: { kind: "tokens", amount: 2048 },
      });
      if (outcome === "replay") {
        // Same job already consumed onto this question — return the already-persisted
        // answer without re-persisting (idempotent). Prefer the client answerId when
        // supplied; else the most recent graded answer for this (user, question).
        if (input.answerId !== undefined) return input.answerId;
        const [prior] = await tx
          .select({ id: userDiscursiveAnswers.id })
          .from(userDiscursiveAnswers)
          .where(
            and(
              eq(userDiscursiveAnswers.questionId, input.questionId),
              ctx.db.conditions(userDiscursiveAnswers),
            ),
          )
          .orderBy(desc(userDiscursiveAnswers.aiGradedAt))
          .limit(1);
        return prior?.id ?? input.questionId;
      }
      return upsertAnswer(tx, ctx, {
        answerId: input.answerId,
        questionId: input.questionId,
        answerText: input.answerText,
        selfScore: input.selfScore,
        timeSpent: input.timeSpent,
        sessionId: input.sessionId,
        ai,
      });
    });
    return { answerId, aiScore: ai.aiScore, aiFeedback: ai.aiFeedback };
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
