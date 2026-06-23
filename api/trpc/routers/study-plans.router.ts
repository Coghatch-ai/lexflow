// api/trpc/routers/study-plans.router.ts
//
// Per-user study plans. Supports two creation modes: "performance" (system
// selects the 3 weakest disciplines from the user's stats) and "custom"
// (user picks disciplines, exam board, phase, year). Progress is computed
// on read from user_answers filtered to the plan's date range + config.
//
// Phase branching: phase='2nd' weakest-area comes from user_discursive_answers
// (avg self/aiScore / maxPoints per area) — oab_questions is 1st-phase MC only.
// Phase='1st' or null uses the existing MC join. The same weakestDisciplines
// helper handles both paths (area code = DISCIPLINE LOV code in both catalogs).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import {
  oabDiscursiveQuestions,
  oabQuestions,
  studyPlans,
  userAnswers,
  userDiscursiveAnswers,
} from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";
import {
  DEADLINE_OPTIONS,
  MIN_ANSWERED_1ST,
  MIN_ANSWERED_2ND,
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

// Build WHERE conditions for oab_questions (1st-phase MC catalog).
function buildMcQuestionConds(config: PlanConfig): SQL[] {
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

// Build WHERE conditions for oab_discursive_questions (2nd-phase catalog).
function buildDiscursiveQuestionConds(config: PlanConfig): SQL[] {
  const conds: SQL[] = [];
  if (config.disciplines.length > 0) {
    conds.push(inArray(oabDiscursiveQuestions.area, config.disciplines));
  }
  if (config.examBoard !== null) {
    conds.push(eq(oabDiscursiveQuestions.examBoard, config.examBoard));
  }
  if (config.year !== null) {
    conds.push(eq(oabDiscursiveQuestions.year, config.year));
  }
  return conds;
}

// Count available questions matching the plan config. Switches table on phase.
async function countAvailable(config: PlanConfig): Promise<number> {
  if (config.phase === "2nd") {
    const discConds = buildDiscursiveQuestionConds(config);
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(oabDiscursiveQuestions)
      .where(discConds.length > 0 ? and(...discConds) : undefined);
    return row?.total ?? 0;
  }
  const mcConds = buildMcQuestionConds(config);
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(oabQuestions)
    .where(mcConds.length > 0 ? and(...mcConds) : undefined);
  return row?.total ?? 0;
}

// Fetch per-discipline stats from the MC (1st-phase) catalog.
async function fetchMcDisciplineStats(userId: string, phase: string | null) {
  const conds: SQL[] = [eq(userAnswers.userId, userId)];
  if (phase !== null) {
    conds.push(eq(oabQuestions.phase, phase));
  }
  return db
    .select({
      discipline: oabQuestions.discipline,
      totalAnswered: sql<number>`count(*)::int`,
      accuracy: sql<number>`round(100.0 * sum(case when ${userAnswers.correct} then 1 else 0 end) / count(*))::int`,
    })
    .from(userAnswers)
    .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
    .where(and(...conds))
    .groupBy(oabQuestions.discipline);
}

// Fetch per-area stats from the discursive (2nd-phase) catalog. Uses
// coalesce(selfScore, aiScore) so partially-AI-graded answers contribute;
// rows where both are null are excluded from the average (nullif guard prevents
// them from counting as 0%, which would skew rankings).
async function fetchDiscursiveAreaStats(userId: string) {
  return db
    .select({
      discipline: oabDiscursiveQuestions.area,
      totalAnswered: sql<number>`count(*)::int`,
      accuracy: sql<number>`coalesce(round(avg(coalesce(${userDiscursiveAnswers.selfScore}, ${userDiscursiveAnswers.aiScore}) / nullif(${oabDiscursiveQuestions.maxPoints}, 0)) * 100), 0)::int`,
    })
    .from(userDiscursiveAnswers)
    .innerJoin(
      oabDiscursiveQuestions,
      eq(userDiscursiveAnswers.questionId, oabDiscursiveQuestions.id),
    )
    .where(eq(userDiscursiveAnswers.userId, userId))
    .groupBy(oabDiscursiveQuestions.area);
}

type AnsweredCounts = { total: number; today: number };

// Count how many answers the user has submitted since planStart that match the
// plan config. Switches between discursive and MC tables based on config.phase.
async function fetchAnsweredCounts(
  userId: string,
  config: PlanConfig,
  planStart: string,
  todayStr: string,
): Promise<AnsweredCounts> {
  if (config.phase === "2nd") {
    const discConds = buildDiscursiveQuestionConds(config);
    const baseConds: SQL[] = [
      eq(userDiscursiveAnswers.userId, userId),
      gte(userDiscursiveAnswers.createdAt, planStart),
    ];
    const allConds: SQL[] = [...baseConds, ...discConds];
    const cols = {
      total: sql<number>`count(*)::int`,
      today: sql<number>`coalesce(sum(case when ${userDiscursiveAnswers.createdAt} >= ${todayStr} then 1 else 0 end), 0)::int`,
    };
    const [row] =
      discConds.length > 0
        ? await db
            .select(cols)
            .from(userDiscursiveAnswers)
            .innerJoin(
              oabDiscursiveQuestions,
              eq(userDiscursiveAnswers.questionId, oabDiscursiveQuestions.id),
            )
            .where(and(...allConds))
        : await db
            .select(cols)
            .from(userDiscursiveAnswers)
            .where(and(...baseConds));
    return { total: row?.total ?? 0, today: row?.today ?? 0 };
  }
  const mcConds = buildMcQuestionConds(config);
  const baseConds: SQL[] = [eq(userAnswers.userId, userId), gte(userAnswers.createdAt, planStart)];
  const allConds: SQL[] = [...baseConds, ...mcConds];
  const cols = {
    total: sql<number>`count(*)::int`,
    today: sql<number>`coalesce(sum(case when ${userAnswers.createdAt} >= ${todayStr} then 1 else 0 end), 0)::int`,
  };
  const [row] =
    mcConds.length > 0
      ? await db
          .select(cols)
          .from(userAnswers)
          .innerJoin(oabQuestions, eq(userAnswers.questionId, oabQuestions.id))
          .where(and(...allConds))
      : await db
          .select(cols)
          .from(userAnswers)
          .where(and(...baseConds));
  return { total: row?.total ?? 0, today: row?.today ?? 0 };
}

export const studyPlansRouter = router({
  availableYears: protectedProcedure.query(async () => {
    const rows = await db
      .selectDistinct({ year: oabQuestions.year })
      .from(oabQuestions)
      .orderBy(desc(oabQuestions.year));
    return rows.map((r) => r.year);
  }),

  generateRecommendation: protectedProcedure
    .input(z.object({ phase: z.string().nullable().default(null) }))
    .query(async ({ ctx, input }) => {
      if (input.phase === "2nd") {
        const stats = await fetchDiscursiveAreaStats(ctx.userId);
        const disciplines = weakestDisciplines(stats, MIN_ANSWERED_2ND, 3);
        return { disciplines };
      }
      const stats = await fetchMcDisciplineStats(ctx.userId, input.phase);
      const disciplines = weakestDisciplines(stats, MIN_ANSWERED_1ST, 3);
      return { disciplines };
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    let config: PlanConfig = input.config;

    if (input.mode === "performance") {
      let stats: Array<{ discipline: string; totalAnswered: number; accuracy: number }>;
      let minAnswered: number;

      if (config.phase === "2nd") {
        stats = await fetchDiscursiveAreaStats(ctx.userId);
        minAnswered = MIN_ANSWERED_2ND;
      } else {
        stats = await fetchMcDisciplineStats(ctx.userId, config.phase);
        minAnswered = MIN_ANSWERED_1ST;
      }

      const disciplines = weakestDisciplines(stats, minAnswered, 3);
      if (disciplines.length === 0) {
        const threshold = config.phase === "2nd" ? MIN_ANSWERED_2ND : MIN_ANSWERED_1ST;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Responda pelo menos ${threshold} ${config.phase === "2nd" ? "questões discursivas" : "questões"} em cada disciplina para gerar um plano por desempenho.`,
        });
      }
      config = { ...config, disciplines };
    }

    // Count available questions matching the plan config (MC or discursive)
    const available = await countAvailable(config);
    const questionsPerDay = questionsPerDayCalc(available, input.deadlineDays);

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
        const { total: totalAnsweredInRange, today: answeredToday } = await fetchAnsweredCounts(
          ctx.userId,
          plan.config,
          plan.createdAt,
          todayStr,
        );

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
          config: plan.config,
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
