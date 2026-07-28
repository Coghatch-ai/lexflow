// api/trpc/routers/ai.router.ts
//
// AI completions, routed through LexFlow's own relay (lexflow-relay → Gemini/OpenAI).
// The prompt is server-owned (api/lib/ai-prompts.ts): the client sends domain
// inputs, the API builds the variables (shared/domain/ai-eval.ts, ai-tutor.ts),
// resolves the template, and ENQUEUES the job to the relay outbox. The relay runs
// async and writes the result to S3; the client polls relay.job.
//
// Spend routing (S3 — issue #52):
//   grade    → CORE → allowance_ledger (assertCoreAction / debitAllowance)
//   tutorAsk → NON-CORE → credit_ledger (assertCredits / debitCredits)
//
// grade: pure procedure (no DB writes); persistence stays in discursive.saveAnswer
// (client-driven, like the self-score).
// tutor*: the per-question buddy. tutorAsk is quota-gated (the only free-input AI
// surface) and persists the user turn; tutorFinalize re-reads the relay result
// server-side (never trusts client text) and persists the assistant turn.
//
// Paid-path spend order (Codex 5th-pass fix — issue #52):
//   mintJobId → assertCoreAction(jobId) → debitAllowance (PAID only, BEFORE enqueue)
//   → enqueueRelayJob → [on enqueue throw: refundAllowance (paid) / reverseFreeTierCounter (free)]
// Net invariant: a paid relay job is NEVER dispatched unless its debit is durably
// recorded first; if dispatch fails, the debit is reversed. Free path: claim-before-
// enqueue + reverse-on-failure (unchanged from 4th-pass).

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../procedures";
import { db } from "../../db/client";
import { aiTutorMessages, oabQuestions, users } from "../../../drizzle/schema";
import { enqueueRelayJob, getRelayJob, mintJobId } from "../../lib/relay";
import { enqueueStreamTicket } from "../../lib/stream-ticket";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { assertCredits, debitCredits, refundCredits } from "../../lib/credits";
import {
  assertCoreAction,
  debitAllowance,
  refundAllowance,
  reverseFreeTierCounter,
} from "../../lib/allowance";
import { buildGradeVariables } from "../../../shared/domain/ai-eval";
import { admissionRead, resolveMeteringModel, settleDelivered } from "../../lib/ai-metering";
import { ALLOWANCE_COST } from "../../../shared/domain/allowance";
import { CREDIT_COSTS } from "../../../shared/domain/credits";
import {
  TUTOR_FOLLOW_UP_MAX_CHARS,
  TUTOR_MODES,
  buildTutorVariables,
  parseTutorResponse,
  tutorRequestText,
} from "../../../shared/domain/ai-tutor";

const providerSchema = z.enum(["gemini", "openai"]).optional();

const gradeInput = z.object({
  statement: z.string().min(1),
  studentAnswer: z.string().min(1),
  modelAnswer: z.string().nullable(),
  legalBasis: z.string().nullable(),
  maxPoints: z.number().positive(),
  // Optional per-task provider override; absent → relay SSM default (gemini).
  provider: providerSchema,
  model: z.string().min(1).optional(),
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
  // 2ª-fase discursive grading — CORE action → draws allowance_ledger (S3 #52).
  // Returns a jobId; the client polls relay.job for the result.
  // Spend order (Codex 5th-pass):
  //   mintJobId → assertCoreAction(jobId) → debitAllowance (PAID, BEFORE enqueue)
  //   → enqueueRelayJob → [on throw: refundAllowance (paid) | reverseFreeTierCounter (free)]
  // A paid relay job is NEVER dispatched without a prior durable debit row.
  // If enqueue fails, the pre-committed debit is reversed (symmetric with free path).
  grade: protectedProcedure.input(gradeInput).mutation(async ({ ctx, input }) => {
    const providerOptions =
      input.provider !== undefined
        ? {
            provider: input.provider,
            ...(input.model !== undefined ? { model: input.model } : {}),
          }
        : undefined;
    const payload = resolveAiPrompt("oab-grade", buildGradeVariables(input), providerOptions);
    // Step 1: reserve jobId — no relay work started yet.
    const jobId = mintJobId();
    // D3 shadow admission-read (epic #50): OBSERVE the unified balance at the door.
    // Never denies — the OLD debit-at-admission rail (assertCoreAction) below stays
    // authoritative this slice. The read is discarded here; the delivered-only
    // charge + reconcile happen in gradeSettle after the relay result is known.
    await admissionRead(ctx.userId);
    // Step 2: assert entitlement BEFORE any spend or enqueue.
    // On FORBIDDEN nothing is debited or enqueued.
    const tier = await assertCoreAction(ctx.userId, jobId);
    // Step 3 (PAID only): commit spend BEFORE dispatch. If the ledger write fails,
    // no S3 job is enqueued — no partial window. The minted jobId is used as ref_id
    // so the relay-error refundAllowance path still matches (same id, same row).
    if (tier === "paid") {
      await debitAllowance(ctx.userId, jobId);
    }
    // Step 4: dispatch relay job. On failure, reverse whichever rail was claimed.
    try {
      await enqueueRelayJob(ctx.userId, payload, jobId);
    } catch (enqueueErr) {
      if (tier === "free") {
        await reverseFreeTierCounter(ctx.userId, jobId);
      } else {
        // Paid debit already committed — reverse it so the user isn't charged for
        // an undelivered job. Idempotent via refund:<jobId> unique ref_id.
        await refundAllowance(ctx.userId, jobId);
      }
      throw enqueueErr;
    }
    return { jobId };
  }),

  // D3 (epic #50) — delivered-only SHADOW settle for grade. The client calls this
  // after polling relay.job to done, before persisting the grade via
  // discursive.saveAnswer. It re-reads the relay result server-side (delivery is
  // authoritative here, never client-asserted) and fires the shadow charge +
  // reconcile metric. Writes NOTHING in shadow; a not-delivered job is a total
  // no-op. The OLD allowance/free-counter rail already settled at enqueue and is
  // untouched — this only OBSERVES.
  gradeSettle: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      const delivered = job.status === "done";
      const result = await settleDelivered({
        userId: ctx.userId,
        source: "grade",
        refId: `grade:${input.jobId}`,
        // Metering model MUST be server-derived (Codex F1): a client-supplied model
        // would let an unknown string force rawCents=0 (costFor→0) and dodge the
        // charge once D4 enforces. resolveMeteringModel() (no arg) → PROD_DEFAULT_MODEL,
        // the relay's live selection. No client value reaches costFor().
        model: resolveMeteringModel(),
        // Grade output is the graded feedback (JSON) — meter on the prompt's output
        // budget as a stable per-action usage proxy until real token counts flow.
        usage: { kind: "tokens", amount: 2048 },
        delivered,
        oldDebitCents: ALLOWANCE_COST,
        action: "grade",
      });
      return { settled: result?.outcome ?? "skipped" };
    }),

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

    // D3 shadow admission-read (epic #50): observe-only, never denies. The old
    // assertCredits below stays authoritative; delivered-only charge is in tutorFinalize.
    await admissionRead(ctx.userId);
    await assertCredits(ctx.userId, "tutor");

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

    // Spend order (mirrors grade / allowance path — issue #55):
    //   mintJobId → assertCredits (above) → debitCredits BEFORE enqueue
    //   → enqueueRelayJob → [on throw: refundCredits]
    // A relay job is NEVER dispatched unless the debit row is durable first;
    // if dispatch fails the debit is reversed (symmetric with allowance rail).
    const tutorJobId = mintJobId();
    await debitCredits(ctx.userId, "tutor", tutorJobId);

    let jobId: string;
    try {
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
    } catch (enqueueErr) {
      // Dispatch failed — reverse the pre-committed debit. Idempotent via refund:<jobId>.
      await refundCredits(ctx.userId, tutorJobId);
      throw enqueueErr;
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
      const raw = job.data as { text: string };
      const parsed = parseTutorResponse(raw.text);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "A IA retornou um formato inesperado",
        });
      }
      await db.insert(aiTutorMessages).values({
        userId: ctx.userId,
        questionId: input.questionId,
        role: "assistant",
        content: parsed.answer,
        createdBy: ctx.userId,
        lastUpdBy: ctx.userId,
      });
      // D3 delivered-only SHADOW charge (epic #50): the relay result is confirmed
      // done above (pending/error already threw), so delivered=true. Writes nothing
      // in shadow; the old credit debit at tutorAsk stays authoritative.
      await settleDelivered({
        userId: ctx.userId,
        source: "tutor",
        refId: `tutor:${input.jobId}`,
        model: resolveMeteringModel(),
        usage: { kind: "tokens", amount: 900 },
        delivered: true,
        oldDebitCents: CREDIT_COSTS.tutor,
        action: "tutorAsk",
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
