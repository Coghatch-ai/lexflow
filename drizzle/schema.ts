// drizzle/schema.ts
//
// Single source of truth for the LexFlow database (PostgreSQL on the shared
// mrhewbuc-rds instance, database `lexflow`).
//
// Model: single-user B2C. `users` rows are individual students linked to Clerk
// via `external_id`. `oab_questions` is a global public catalog. Every other
// table is owned by exactly one user (`user_id` FK) — scoping is enforced in
// the app via api/db/scope.ts (createScopedDb({ userId })). No tenants, no orgs.
//
// Every table carries the four system fields (created_at/by, last_upd_at/by)
// per the conventions doc. Soft-delete (deleted_at) is intentionally omitted —
// none of these tables are soft-deletable at POC stage.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// The four system audit columns present on every table without exception.
const systemFields = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  createdBy: uuid("created_by"),
  lastUpdAt: timestamp("last_upd_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  lastUpdBy: uuid("last_upd_by"),
};

// ── Identity ────────────────────────────────────────────────────────────────

// People. `external_id` holds Clerk's user id. POC: rows are created manually
// via `pnpm db:create-user` (the Clerk webhook path is deferred).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  ...systemFields,
});

// ── Global catalog ───────────────────────────────────────────────────────────

// OAB exam questions — public, not user-scoped.
export const oabQuestions = pgTable(
  "oab_questions",
  {
    id: text("id").primaryKey(),
    questionText: text("question_text").notNull(),
    options: jsonb("options").$type<string[]>().notNull(),
    correctAnswer: text("correct_answer").notNull(),
    legalBasis: text("legal_basis").notNull(),
    explanation: text("explanation").notNull(),
    legislationLink: text("legislation_link").notNull(),
    legislationTitle: text("legislation_title").notNull(),
    difficulty: text("difficulty").notNull(), // 'easy' | 'medium' | 'hard'
    discipline: text("discipline").notNull(),
    topic: text("topic").notNull(),
    examBoard: text("exam_board").notNull(), // 'FGV' | 'CESPE'
    year: integer("year").notNull(),
    phase: text("phase").notNull(), // '1st' | '2nd'
    ...systemFields,
  },
  (t) => [
    index("idx_oab_discipline").on(t.discipline),
    index("idx_oab_exam_board").on(t.examBoard),
    index("idx_oab_difficulty").on(t.difficulty),
    index("idx_oab_year").on(t.year),
  ],
);

// ── Per-user activity ─────────────────────────────────────────────────────────

export const userAnswers = pgTable(
  "user_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => oabQuestions.id),
    userAnswer: text("user_answer").notNull(),
    correct: boolean("correct").notNull(),
    timeSpent: integer("time_spent").notNull(), // seconds
    ...systemFields,
  },
  (t) => [
    index("idx_user_answers_user").on(t.userId),
    index("idx_user_answers_question").on(t.questionId),
  ],
);

export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    totalQuestions: integer("total_questions").notNull().default(0),
    correctAnswers: integer("correct_answers").notNull().default(0),
    discipline: text("discipline").notNull(),
    difficulty: text("difficulty").notNull(), // 'easy' | 'medium' | 'hard'
    ...systemFields,
  },
  (t) => [index("idx_study_sessions_user").on(t.userId)],
);

// ── Per-user aggregates ───────────────────────────────────────────────────────

export const userPerformanceStats = pgTable("user_performance_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  totalAnswered: integer("total_answered").notNull().default(0),
  totalCorrect: integer("total_correct").notNull().default(0),
  accuracy: numeric("accuracy").notNull().default("0"), // 0–100
  totalSessions: integer("total_sessions").notNull().default(0),
  averageTimePerQuestion: numeric("average_time_per_question").notNull().default("0"),
  ...systemFields,
});

export const disciplinePerformance = pgTable(
  "discipline_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    discipline: text("discipline").notNull(),
    totalAnswered: integer("total_answered").notNull().default(0),
    totalCorrect: integer("total_correct").notNull().default(0),
    accuracy: numeric("accuracy").notNull().default("0"),
    ...systemFields,
  },
  (t) => [
    unique("uq_discipline_perf_user_discipline").on(t.userId, t.discipline),
    index("idx_discipline_perf_user").on(t.userId),
  ],
);

export const examBoardPerformance = pgTable(
  "exam_board_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examBoard: text("exam_board").notNull(), // 'FGV' | 'CESPE'
    totalAnswered: integer("total_answered").notNull().default(0),
    totalCorrect: integer("total_correct").notNull().default(0),
    accuracy: numeric("accuracy").notNull().default("0"),
    ...systemFields,
  },
  (t) => [
    unique("uq_exam_board_perf_user_board").on(t.userId, t.examBoard),
    index("idx_exam_board_perf_user").on(t.userId),
  ],
);

// ── Goals & notifications ─────────────────────────────────────────────────────

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    discipline: text("discipline").notNull(),
    targetAccuracy: numeric("target_accuracy").notNull(), // 0–100
    ...systemFields,
  },
  (t) => [index("idx_user_goals_user").on(t.userId)],
);

export const goalNotifications = pgTable(
  "goal_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => userGoals.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'progress' | 'achieved' | 'warning'
    message: text("message").notNull(),
    read: boolean("read").notNull().default(false),
    ...systemFields,
  },
  (t) => [index("idx_goal_notif_user").on(t.userId), index("idx_goal_notif_goal").on(t.goalId)],
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
  answers: many(userAnswers),
  sessions: many(studySessions),
  goals: many(userGoals),
  stats: one(userPerformanceStats),
}));

export const userGoalsRelations = relations(userGoals, ({ one, many }) => ({
  user: one(users, { fields: [userGoals.userId], references: [users.id] }),
  notifications: many(goalNotifications),
}));
