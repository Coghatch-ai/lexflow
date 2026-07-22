// api/trpc/routers/coach.router.ts
//
// Weak-point coach ("Análise do Coach"). generate assembles the student's real
// aggregates server-side (same SQL family as stats.router), enqueues one relay
// job, and is both cooldown- and quota-gated; finalize re-reads the relay result
// (never trusts client text), validates, and persists the digest row. latest
// serves the cached digest — the cache is the main cost/abuse control.

import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../procedures";
import { db } from "../../db/client";
import {
  aiCoachDigests,
  examCalendarEvents,
  oabQuestions,
  userAnswers,
  userQuestionStates,
} from "../../../drizzle/schema";
import { enqueueRelayJob, getRelayJob } from "../../lib/relay";
import { resolveAiPrompt } from "../../lib/ai-prompts";
import { assertAndIncrementQuota } from "../../lib/ai-quota";
import { assertCredits, debitCredits } from "../../lib/credits";
import { accuracyPct } from "../../../shared/domain/scoring";
import { LOV_SEED } from "../../../shared/data/lov";
import {
  COACH_COOLDOWN_HOURS,
  COACH_DAILY_LIMIT,
  COACH_MIN_ANSWERED,
  buildCoachVariables,
  parseCoachResponse,
  type CoachStudentData,
} from "../../../shared/domain/ai-coach";

const DISCIPLINE_LABEL = new Map(
  LOV_SEED.filter((r) => r.type === "DISCIPLINE").map((r) => [r.code, r.value]),
);

function isFresh(createdAt: string): boolean {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs < COACH_COOLDOWN_HOURS * 60 * 60 * 1000;
}

// Assemble the aggregates the digest is grounded in. Mirrors stats.router
// queries (kept inline: this payload is the coach's contract, not the UI's).
async function assembleStudentData(userId: string): Promise<CoachStudentData> {
  const [summary] = await db
    .select({
      totalAnswered: sql<number>`count(*)::int`,
      totalCorrect: sql<number>`coalesce(sum(case when ${userAnswers.correct} then 1 else 0 end), 0)::int`,
      averageTimePerQuestion: sql<number>`coalesce(round(avg(${userAnswers.timeSpent})), 0)::int`,
    })
    .from(userAnswers)
    .where(eq(userAnswers.userId, userId));

  const disciplines = await db
    .select({
      discipline: oabQuestions.discipline,
      totalAnswered: sql<number>`count(*)::int`,
      accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
    })
    .from(userAnswers)
    .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
    .where(eq(userAnswers.userId, userId))
    .groupBy(oabQuestions.discipline);

  const timeBuckets = await db
    .select({
      bucket: sql<string>`case when ${userAnswers.timeSpent} < 30 then 'fast' when ${userAnswers.timeSpent} < 90 then 'medium' else 'slow' end`,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`sum(case when ${userAnswers.correct} then 0 else 1 end)::int`,
    })
    .from(userAnswers)
    .where(eq(userAnswers.userId, userId))
    .groupBy(sql`1`);

  const recurring = await db
    .select({
      discipline: oabQuestions.discipline,
      count: sql<number>`count(*)::int`,
    })
    .from(userAnswers)
    .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
    .where(eq(userAnswers.userId, userId))
    .groupBy(userAnswers.questionId, oabQuestions.discipline)
    .having(sql`count(*) >= 2 and sum(case when ${userAnswers.correct} then 0 else 1 end) >= 2`);

  const [due] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userQuestionStates)
    .where(
      and(eq(userQuestionStates.userId, userId), lte(userQuestionStates.nextReviewAt, sql`now()`)),
    );

  const today = new Date().toISOString().slice(0, 10);
  const [nextEvent] = await db
    .select({ eventDate: examCalendarEvents.eventDate })
    .from(examCalendarEvents)
    .where(gte(examCalendarEvents.eventDate, today))
    .orderBy(examCalendarEvents.eventDate)
    .limit(1);
  const daysToExam =
    nextEvent?.eventDate != null
      ? Math.max(
          0,
          Math.ceil((new Date(nextEvent.eventDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;

  const totalAnswered = summary?.totalAnswered ?? 0;
  const totalCorrect = summary?.totalCorrect ?? 0;

  return {
    totalAnswered,
    totalCorrect,
    accuracy: accuracyPct(totalCorrect, totalAnswered),
    averageTimePerQuestion: summary?.averageTimePerQuestion ?? 0,
    disciplines: disciplines.map((d) => ({
      discipline: d.discipline,
      label: DISCIPLINE_LABEL.get(d.discipline) ?? d.discipline,
      totalAnswered: d.totalAnswered,
      accuracy: d.accuracy,
    })),
    timeBuckets,
    recurringErrorCount: recurring.length,
    recurringErrorDisciplines: [...new Set(recurring.map((r) => r.discipline))].map(
      (code) => DISCIPLINE_LABEL.get(code) ?? code,
    ),
    dueForReview: due?.count ?? 0,
    daysToExam,
  };
}

export const coachRouter = router({
  // Latest digest (or null). The UI decides between "Gerar" and "Atualizar"
  // from generatedAt + fresh.
  latest: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        digest: aiCoachDigests.digest,
        statsSnapshot: aiCoachDigests.statsSnapshot,
        createdAt: aiCoachDigests.createdAt,
      })
      .from(aiCoachDigests)
      .where(ctx.db.conditions(aiCoachDigests))
      .orderBy(desc(aiCoachDigests.createdAt))
      .limit(1);
    if (row === undefined) return null;
    return { digest: row.digest, generatedAt: row.createdAt, fresh: isFresh(row.createdAt) };
  }),

  // Kick off a generation. Serves the cached digest when fresh (unless force);
  // refuses below COACH_MIN_ANSWERED (no data → generic filler, not coaching).
  generate: protectedProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const force = input?.force ?? false;
      const [latest] = await db
        .select({ digest: aiCoachDigests.digest, createdAt: aiCoachDigests.createdAt })
        .from(aiCoachDigests)
        .where(ctx.db.conditions(aiCoachDigests))
        .orderBy(desc(aiCoachDigests.createdAt))
        .limit(1);
      if (!force && latest !== undefined && isFresh(latest.createdAt)) {
        return { cached: true as const, digest: latest.digest, jobId: null };
      }

      const data = await assembleStudentData(ctx.userId);
      if (data.totalAnswered < COACH_MIN_ANSWERED) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Responda pelo menos ${String(COACH_MIN_ANSWERED)} questões para gerar a análise do coach`,
        });
      }

      await assertAndIncrementQuota(ctx.userId, "coach", COACH_DAILY_LIMIT);
      await assertCredits(ctx.userId, "coach");
      const payload = resolveAiPrompt("oab-coach", buildCoachVariables(data));
      const jobId = await enqueueRelayJob(ctx.userId, payload);
      await debitCredits(ctx.userId, "coach", jobId);
      return { cached: false as const, digest: null, jobId, statsSnapshot: data };
    }),

  // Persist the generated digest. Re-reads the relay result server-side and
  // re-assembles the snapshot — nothing model- or stats-shaped comes from the client.
  finalize: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      if (job.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A análise ainda está em andamento" });
      }
      if (job.status === "error") {
        throw new TRPCError({ code: "BAD_GATEWAY", message: job.error });
      }
      const raw = job.data as { text: string };
      const parsed = parseCoachResponse(raw.text);
      if (parsed === null) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "A IA retornou um formato inesperado",
        });
      }
      const snapshot = await assembleStudentData(ctx.userId);
      await db.insert(aiCoachDigests).values({
        userId: ctx.userId,
        digest: parsed,
        statsSnapshot: snapshot,
        createdBy: ctx.userId,
        lastUpdBy: ctx.userId,
      });
      return { digest: parsed };
    }),
});
