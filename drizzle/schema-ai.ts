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

// Per-user daily AI-call counter — abuse guard gating AI procedures. One row
// per (user, day, kind); incremented atomically at enqueue by api/lib/ai-quota.ts.
export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    kind: text("kind").notNull().default("tutor"), // 'tutor' | 'coach' — independent counters per feature
    count: integer("count").notNull().default(0),
    ...systemFields,
  },
  (t) => [unique("uq_ai_usage_user_day_kind").on(t.userId, t.day, t.kind)],
);

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
