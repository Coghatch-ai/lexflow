// api/trpc/routers/study-plans.router.ts
//
// Per-user study plans. Supports two creation modes: "performance" (system
// selects the 3 weakest disciplines from the user's stats) and "custom"
// (user picks disciplines, exam board, phase, year). Progress is computed
// on read from user_answers filtered to the plan's date range + config.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { oabQuestions, studyPlans, userAnswers } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import {
  DEADLINE_OPTIONS,
  questionsPerDayCalc,
  planProgressPct,
  weakestDisciplines,
  type PlanConfig,
} from "../../../shared/domain/study-plan";

const deadlineSchema = z.union([
  z.literal(DEADLINE_OPTIONS[0]),
  z.literal(DEADLINE_OPTIONS[1]),
  z.literal(DEADLINE_OPTIONS[2]),
  z.literal(DEADLINE_OPTIONS[3]),
  z.literal(DEADLINE_OPTIONS[4]),
  z.literal(DEADLINE_OPTIONS[5]),
]);

const configSchema = z.object({
  disciplines: z.array(z.string()).default([]),
  examBoard: z.string().nullable().default(null),
  phase: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
});

const createInput = z.object({
  mode: z.enum(["performance", "custom"]),
  deadlineDays: deadlineSchema,
  config: configSchema,
});

function buildQuestionConds(config: PlanConfig): SQL[] {
  const conds: SQL[] = [];
  if (config.disciplines.length > 0) {
    conds.push(inArray(oabQuestions.discipline, config.disciplines));
  }
  if (config.examBoard !== null) {
    conds.push(eq(oabQuestions.examBoard, config.examBoard));
  }
  if (config.phase !== null) {
    conds.push(eq(oabQuestions.phase, config.phase));
  }
  if (config.year !== null) {
    conds.push(eq(oabQuestions.year, config.year));
  }
  return conds;
}

async function fetchDisciplineStats(userId: string) {
  return db
    .select({
      discipline: oabQuestions.discipline,
      totalAnswered: sql<number>`count(*)::int`,
      accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
    })
    .from(userAnswers)
    .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
    .where(eq(userAnswers.userId, userId))
    .groupBy(oabQuestions.discipline);
}

export const studyPlansRouter = router({
  availableYears: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ year: oabQuestions.year })
      .from(oabQuestions)
      .orderBy(desc(oabQuestions.year));
    return rows.map((r) => r.year);
  }),

  generateRecommendation: protectedProcedure.query(async ({ ctx }) => {
    const stats = await fetchDisciplineStats(ctx.userId);
    const disciplines = weakestDisciplines(stats, 5, 3);
    return { disciplines };
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    let config: PlanConfig = input.config;

    if (input.mode === "performance") {
      const stats = await fetchDisciplineStats(ctx.userId);
      const disciplines = weakestDisciplines(stats, 5, 3);
      if (disciplines.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Responda pelo menos 5 questões em cada disciplina para gerar um plano por desempenho.",
        });
      }
      config = { ...config, disciplines };
    }

    // Count available questions matching the plan config
    const questionConds = buildQuestionConds(config);
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(oabQuestions)
      .where(questionConds.length > 0 ? and(...questionConds) : undefined);

    const availableCount = countRow?.total ?? 0;
    const questionsPerDay = questionsPerDayCalc(availableCount, input.deadlineDays);

    const now = new Date();
    const targetDate = new Date(now.getTime() + input.deadlineDays * 86400000);

    const [row] = await db
      .insert(studyPlans)
      .values({
        userId: ctx.userId,
        mode: input.mode,
        deadlineDays: input.deadlineDays,
        targetDate: targetDate.toISOString(),
        questionsPerDay,
        config,
        createdBy: ctx.userId,
        lastUpdBy: ctx.userId,
      })
      .returning({ id: studyPlans.id });

    if (row === undefined) throw new Error("study plan insert returned no row");
    return { id: row.id };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const plans = await db
      .select()
      .from(studyPlans)
      .where(ctx.db.conditions(studyPlans))
      .orderBy(desc(studyPlans.createdAt));

    const now = Date.now();
    const todayMidnight = new Date(now);
    todayMidnight.setUTCHours(0, 0, 0, 0);
    const todayStr = todayMidnight.toISOString();

    const withProgress = await Promise.all(
      plans.map(async (plan) => {
        const config = plan.config;
        const questionConds = buildQuestionConds(config);

        const answerConds: SQL[] = [
          eq(userAnswers.userId, ctx.userId),
          gte(userAnswers.createdAt, plan.createdAt),
        ];

        const allConds: SQL[] = [...answerConds, ...questionConds];

        let result: Array<{ total: number; today: number }>;

        if (questionConds.length > 0) {
          result = await db
            .select({
              total: sql<number>`count(*)::int`,
              today: sql<number>`coalesce(sum(case when ${userAnswers.createdAt} >= ${todayStr} then 1 else 0 end), 0)::int`,
            })
            .from(userAnswers)
            .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
            .where(and(...allConds));
        } else {
          result = await db
            .select({
              total: sql<number>`count(*)::int`,
              today: sql<number>`coalesce(sum(case when ${userAnswers.createdAt} >= ${todayStr} then 1 else 0 end), 0)::int`,
            })
            .from(userAnswers)
            .where(and(...answerConds));
        }

        const row = result[0];
        const totalAnsweredInRange = row?.total ?? 0;
        const answeredToday = row?.today ?? 0;
        const elapsedDays = Math.max(1, Math.ceil((now - Date.parse(plan.createdAt)) / 86400000));
        const progressPct = planProgressPct(
          totalAnsweredInRange,
          plan.questionsPerDay,
          elapsedDays,
        );
        const daysRemaining = Math.max(
          0,
          Math.ceil((Date.parse(plan.targetDate) - now) / 86400000),
        );

        return {
          id: plan.id,
          mode: plan.mode,
          deadlineDays: plan.deadlineDays,
          targetDate: plan.targetDate,
          questionsPerDay: plan.questionsPerDay,
          config,
          createdAt: plan.createdAt,
          answeredToday,
          totalAnsweredInRange,
          progressPct,
          daysRemaining,
        };
      }),
    );

    return withProgress;
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(studyPlans)
        .where(and(eq(studyPlans.id, input.id), ctx.db.conditions(studyPlans)));
      return { ok: true as const };
    }),
});
