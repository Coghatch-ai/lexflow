// api/trpc/routers/ai.router.ts
//
// AI completions, routed through LexFlow's own relay (lexflow-relay → Gemini/OpenAI).
// The prompt is server-owned (api/lib/ai-prompts.ts): the client sends domain
// inputs, the API builds the variables (shared/domain/ai-eval.ts, ai-tutor.ts),
// resolves the template, and ENQUEUES the job to the relay outbox. The relay runs
// async and writes the result to S3; the client polls relay.job.
//
// Admission + spend (D4, epic #50 — one unified engine):
//   admit(userId) reads credit_balances and DENIES at balance <= 0 (grace-at-zero:
//   the last-cent request completes, the next is denied). It is fail-closed with a
//   burst door on a read failure. Spend is metered POST-DELIVERY via consumeAndCharge
//   → the money core charge() (the SOLE spend path). An undelivered relay job is
//   simply never charged, so there is no debit-before-enqueue / refund-on-failure
//   dance any more — nothing is spent until delivery is confirmed server-side.
//
// grade: pure procedure (no DB writes); persistence stays in discursive.saveAnswer.
// tutor*: the per-question buddy. tutorAsk persists the user turn; tutorFinalize
// re-reads the relay result server-side (never trusts client text), persists the
// assistant turn, and settles the charge.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../procedures";
import { db } from "../../db/client";
import { aiTutorMessages, oabQuestions, users } from "../../../drizzle/schema";
import { enqueueRelayJob, getRelayJob, mintJobId } from "../../lib/relay";
import { enqueueStreamTicket } from "../../lib/stream-ticket";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { admit } from "../../lib/admission";
import { buildGradeVariables } from "../../../shared/domain/ai-eval";
import { parseAiResult, meteringOf, consumeAndCharge } from "../../lib/ai-metering";
import { isRequestableModel } from "../../../shared/domain/cost-of-goods";
import {
  TUTOR_FOLLOW_UP_MAX_CHARS,
  TUTOR_MODES,
  buildTutorVariables,
  parseTutorResponse,
  tutorRequestText,
} from "../../../shared/domain/ai-tutor";

const providerSchema = z.enum(["gemini", "openai"]).optional();

// #98 review round 1, finding 2 — FREE-INFERENCE HOLE, closed here.
// `model` used to be `z.string().min(1)`: any string a signed-in client sent was
// forwarded to the real provider, and because an unpriceable delivered call is
// charged 0 by design, asking for an expensive UN-PRICED id bought a real
// completion for nothing. The request side is now an ALLOWLIST of ids that
// price. Enforced at INPUT VALIDATION, so a rejected model never reaches
// admit(), never reaches the outbox, and never reaches a provider — no
// delivered work is lost.
// Round 2, blocker 1: the allowlist is EXACT membership of COST_OF_GOODS —
// snapshot ids are NOT accepted here. Suffix stripping belongs to METERING (the
// id the provider echoes back), never to client input, where it would bill
// `gpt-4o-2024-05-13` at `gpt-4o`'s rate — a rate with no provenance for that
// id. See isRequestableModel in shared/domain/cost-of-goods.ts.
// This constrains only what a CLIENT may REQUEST; the SSM-selected model is
// never gated (metering must never veto a delivered call).
export const requestedModelSchema = z
  .string()
  .min(1)
  .refine(isRequestableModel, { message: "Modelo de IA não suportado" });

const gradeInput = z.object({
  statement: z.string().min(1),
  studentAnswer: z.string().min(1),
  modelAnswer: z.string().nullable(),
  legalBasis: z.string().nullable(),
  maxPoints: z.number().positive(),
  // Optional per-task provider override; absent → relay SSM default (gemini).
  provider: providerSchema,
  // Only a PRICED model may be requested — see requestedModelSchema above.
  model: requestedModelSchema.optional(),
});

const tutorAskInput = z.object({
  questionId: z.string().min(1),
  mode: z.enum(TUTOR_MODES),
  /** Option text the student selected; null when the flow doesn't know it. */
  userAnswer: z.string().min(1).nullable(),
  followUp: z.string().trim().min(1).max(TUTOR_FOLLOW_UP_MAX_CHARS).optional(),
  /** true → stream ticket for the browser-direct streaming Lambda; else relay. */
  stream: z.boolean().optional(),
});

export const aiRouter = router({
  // 2ª-fase discursive grading. Admission reads the unified balance (grace-at-zero,
  // fail-closed burst). Returns a jobId; the client polls relay.job, then persists
  // via discursive.saveAnswer(gradeJobId=jobId) — which settles the charge
  // SERVER-SIDE on that same delivery/consume path (no separate optional settle
  // proc). Nothing is spent at enqueue; an undelivered job is never charged.
  grade: protectedProcedure.input(gradeInput).mutation(async ({ ctx, input }) => {
    const providerOptions =
      input.provider !== undefined
        ? {
            provider: input.provider,
            ...(input.model !== undefined ? { model: input.model } : {}),
          }
        : undefined;
    const payload = resolveAiPrompt("oab-grade", buildGradeVariables(input), providerOptions);
    // Admission: DENY at balance <= 0 (grace-at-zero). Fail-closed burst on read fail.
    await admit(ctx.userId);
    const jobId = mintJobId();
    await enqueueRelayJob(ctx.userId, payload, jobId);
    return { jobId };
  }),

  // NOTE: grade settlement lives SERVER-SIDE on the consume/persist path
  // (discursive.saveAnswer, keyed refId `grade:<jobId>`), NOT in a separate
  // client-called proc — so a delivered grade cannot be persisted without being
  // charged. The old inert `ai.gradeSettle` proc was removed (Codex #61).

  // Ask the per-question tutor. Quota-gated at enqueue (the cost-commit point);
  // persists the user turn so the thread survives navigation. Returns a jobId;
  // the client polls relay.job then calls tutorFinalize.
  tutorAsk: protectedProcedure.input(tutorAskInput).mutation(async ({ ctx, input }) => {
    if (input.mode === "free_text" && input.followUp === undefined) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Escreva a sua pergunta" });
    }
    const [question] = await db
      .select({
        questionText: oabQuestions.questionText,
        options: oabQuestions.options,
        correctAnswer: oabQuestions.correctAnswer,
        explanation: oabQuestions.explanation,
        legalBasis: oabQuestions.legalBasis,
      })
      .from(oabQuestions)
      .where(eq(oabQuestions.id, input.questionId))
      .limit(1);
    if (question === undefined) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Questão não encontrada" });
    }

    // Admission: DENY at balance <= 0 (grace-at-zero). Fail-closed burst on read fail.
    // Charge settles post-delivery in tutorFinalize.
    await admit(ctx.userId);

    const followUp = input.followUp ?? null;
    const payload = resolveAiPrompt(
      "oab-tutor",
      buildTutorVariables({
        questionText: question.questionText,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        legalBasis: question.legalBasis ?? null,
        userAnswer: input.userAnswer,
        mode: input.mode,
        followUp,
      }),
    );

    // Nothing is spent at enqueue — the charge settles post-delivery in tutorFinalize
    // (an undelivered job is never charged), so no debit/refund dance here.
    const tutorJobId = mintJobId();
    let jobId: string;
    if (input.stream === true) {
      const [me] = await db
        .select({ externalId: users.externalId })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1);
      if (me === undefined) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      }
      jobId = await enqueueStreamTicket(ctx.userId, me.externalId, payload, tutorJobId);
    } else {
      jobId = await enqueueRelayJob(ctx.userId, payload, tutorJobId);
    }

    await db.insert(aiTutorMessages).values({
      userId: ctx.userId,
      questionId: input.questionId,
      role: "user",
      mode: input.mode,
      content: tutorRequestText(input.mode, followUp),
      createdBy: ctx.userId,
      lastUpdBy: ctx.userId,
    });

    return { jobId };
  }),

  // Persist the tutor's reply. The answer text is NEVER accepted from the client —
  // this re-reads the relay result server-side (keyed by ctx.userId + jobId),
  // validates it, and stores the assistant turn.
  tutorFinalize: protectedProcedure
    .input(z.object({ questionId: z.string().min(1), jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      if (job.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A resposta ainda está em andamento" });
      }
      if (job.status === "error") {
        throw new TRPCError({ code: "BAD_GATEWAY", message: job.error });
      }
      // Parse OUTSIDE the transaction: text + the REAL metering facts. The
      // stream Lambda writes the SAME shape, so `stream:true` meters too (#98).
      const ai = parseAiResult(job.data);
      const parsed = parseTutorResponse(ai.text);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "A IA retornou um formato inesperado",
        });
      }
      // ATOMIC persist + single-use consume + charge (Codex #61 round 4). The consume
      // marker + charge + assistant-message INSERT all run in ONE transaction: they
      // commit or roll back together, so a persisted tutor reply can never outlive its
      // charge. The marker is BOUND to input.questionId (the thread the reply belongs
      // to): a replay of the same jobId onto a DIFFERENT question is REJECTED (CONFLICT);
      // onto the SAME question it is an idempotent no-op (the assistant turn was already
      // inserted + charged once — a replay must NOT append a second turn). refId
      // `tutor:<jobId>` is shared by the marker (PK) and charge().
      await db.transaction(async (tx) => {
        const outcome = await consumeAndCharge({
          tx,
          userId: ctx.userId,
          jobId: input.jobId,
          targetId: input.questionId,
          source: "tutor",
          refId: `tutor:${input.jobId}`,
          // Server-read facts only — `grade` lets the CLIENT pick provider/model
          // for the call, but never for the charge.
          metering: meteringOf(ai),
        });
        if (outcome === "replay") return; // reply already inserted + charged once.
        await tx.insert(aiTutorMessages).values({
          userId: ctx.userId,
          questionId: input.questionId,
          role: "assistant",
          content: parsed.answer,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        });
      });
      return { answer: parsed.answer };
    }),

  // Thread for one question, oldest first.
  tutorHistory: protectedProcedure
    .input(z.object({ questionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return db
        .select({
          id: aiTutorMessages.id,
          role: aiTutorMessages.role,
          mode: aiTutorMessages.mode,
          content: aiTutorMessages.content,
          createdAt: aiTutorMessages.createdAt,
        })
        .from(aiTutorMessages)
        .where(
          and(eq(aiTutorMessages.questionId, input.questionId), ctx.db.conditions(aiTutorMessages)),
        )
        .orderBy(aiTutorMessages.createdAt);
    }),
});
