// drizzle/schema-ai.ts
//
// AI-buddy + billing tables, split from schema.ts (max-lines). Re-exported by
// schema.ts (`export * from "./schema-ai"`), so app imports and drizzle-kit's
// single-entry config are unchanged. References to users/oab_questions are lazy
// (arrow callbacks), so the circular import with schema.ts is safe.

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  date,
} from "drizzle-orm/pg-core";
import type { CoachDigest, CoachStudentData } from "../shared/domain/ai-coach";
import { users, oabQuestions } from "./schema";

// Same four system audit columns as schema.ts (kept local — importing the
// non-exported const would require widening schema.ts's surface).
const systemFields = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  createdBy: uuid("created_by"),
  lastUpdAt: timestamp("last_upd_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  lastUpdBy: uuid("last_upd_by"),
};

// ─── Monetization — S1 + S2 ────────────────────────────────────────────────

// Active subscription per user. One row per user; status tracks the lifecycle.
// provider_ref / provider_sub_id are nullable placeholders for a future gateway.
// Plan and period dates enable the anniversary-based allowance reset in S3.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(), // LOV code: 'free' | 'paid' (admin-editable)
    status: text("status").notNull(), // 'active' | 'canceled' | 'past_due'
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    // Gateway placeholders — nullable until payment integration (S-later).
    providerRef: text("provider_ref"),
    providerSubId: text("provider_sub_id"),
    ...systemFields,
  },
  (t) => [index("idx_subscriptions_user").on(t.userId)],
);

// Month-grained allowance ledger for CORE AI (phase-1 explanation + phase-2
// grading). Mirrors credit_ledger money invariants:
//   balance = SUM(delta); unique ref_id bars double-spend/double-refund.
// periodStart anchors the subscription anniversary window so S3 can expire
// stale carry-over (rollover cap = one month's worth of allowance).
// AllowanceAction values: 'monthly_grant' | 'top_up' | 'spend' | 'refund' |
//   'rollover' | 'expire' — extended by S3/S4 without schema change.
export const allowanceLedger = pgTable(
  "allowance_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // signed units (positive = grant, negative = spend)
    action: text("action").notNull(), // AllowanceAction
    refId: text("ref_id").unique(), // idempotency key (jobId / refund:<jobId> / grant:<coupon>:<userId>)
    periodStart: timestamp("period_start", { withTimezone: true, mode: "string" }), // subscription period this row belongs to
    note: text("note"),
    ...systemFields,
  },
  (t) => [index("idx_allowance_ledger_user_created").on(t.userId, t.createdAt)],
);

// Free-tier daily counter — 1 core AI use per calendar day (America/Sao_Paulo).
// One row per (user, day); atomic claim via INSERT … ON CONFLICT DO UPDATE WHERE
// count < LIMIT. last_job_id tracks which job holds the current claim so the
// reverse (on relay error) is idempotent: UPDATE WHERE last_job_id = jobId.
// Day stored as ISO date in São Paulo timezone (computed server-side, never client).
// Replaces the retired ai_usage_daily — this counter is entitlement, not abuse cap.
export const freeDailyCounter = pgTable(
  "free_daily_counter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(), // ISO date in America/Sao_Paulo
    count: integer("count").notNull().default(0),
    lastJobId: uuid("last_job_id"), // jobId that claimed today's use (nullable; cleared on reverse)
    ...systemFields,
  },
  (t) => [unique("uq_free_daily_counter_user_day").on(t.userId, t.day)],
);

// ───────────────────────────────────────────────────────────────────────────

// Per-question AI tutor thread. Stateless one-shots server-side; rows exist so
// the conversation renders as a thread and survives navigation. Assistant text
// is only written by tutorFinalize from the relay result (never client-supplied).
export const aiTutorMessages = pgTable(
  "ai_tutor_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => oabQuestions.id),
    role: text("role").notNull(), // 'user' | 'assistant'
    mode: text("mode"), // TutorMode on user turns; null on assistant turns
    content: text("content").notNull(),
    ...systemFields,
  },
  (t) => [index("idx_ai_tutor_user_question").on(t.userId, t.questionId)],
);

// Cached weak-point coach digests — one row per generation, newest wins. Only
// coach.finalize writes the digest (relay-authored, never client-supplied);
// statsSnapshot = the aggregates it was built from (display/debug).
export const aiCoachDigests = pgTable(
  "ai_coach_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    digest: jsonb("digest").$type<CoachDigest>().notNull(),
    statsSnapshot: jsonb("stats_snapshot").$type<CoachStudentData>(),
    ...systemFields,
  },
  (t) => [index("idx_ai_coach_user_created").on(t.userId, t.createdAt)],
);

// Coupon-based credit grants — the ONLY way a user gains credits until a real
// purchase flow exists (auto signup grants are farmable; maggie #126). Global
// table; `redeemedCount` is the lockable row for the atomic per-coupon cap
// (conditional UPDATE ... WHERE redeemed_count < max_redemptions RETURNING) —
// never derive it by counting ledger rows.
export const coupons = pgTable("coupons", {
  code: text("code").primaryKey(), // XXXX-XXXX, uppercase
  valueCredits: integer("value_credits").notNull(),
  maxRedemptions: integer("max_redemptions").notNull().default(1),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  note: text("note"),
  ...systemFields,
});

// Pay-as-you-go credit ledger — balance = SUM(delta). ref_id = idempotency key
// (jobId spend / refund:<jobId> / coupon:<code>:<userId>); unique index bars doubles.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // signed credits
    action: text("action").notNull(), // LedgerAction: tutor | coach | grade | signup_grant | admin_grant | refund
    refId: text("ref_id").unique(), // idempotency key — nullable for manual grants
    note: text("note"),
    ...systemFields,
  },
  (t) => [index("idx_credit_ledger_user_created").on(t.userId, t.createdAt)],
);
