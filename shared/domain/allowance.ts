// shared/domain/allowance.ts
//
// Allowance domain constants for CORE AI actions (phase-1 explanation +
// phase-2 grading). Allowance is a SEPARATE currency from credits:
//   - Core (explanation/grade) → draws allowance_ledger
//   - Non-core (tutor/coach)   → draws credit_ledger
//
// ALLOWANCE_COST is the per-action unit cost. The numeric value here is a
// placeholder (1 unit per action); the ACTUAL production value lives in the
// admin-editable config table (issue #53) — this constant will be replaced
// by a DB lookup once that table exists. Owner directive: NO magic numbers.
//
// AllowanceAction values stored in allowance_ledger.action:
//   'spend'          — a live LLM call consumed allowance
//   'refund'         — relay job failed; spend reversed
//   'monthly_grant'  — subscription period grant (S6)
//   'top_up'         — coupon or admin grant (S4/S6)
//   'rollover'       — carried forward at period reset (S6)
//   'expire'         — stale rollover dropped (S6)

export const ALLOWANCE_COST = 1 as const; // units per core action — replace with config table (S5)

export type AllowanceAction =
  | "spend"
  | "refund"
  | "monthly_grant"
  | "top_up"
  | "rollover"
  | "expire"
  | "admin_grant";

// Free-tier daily limit: 1 core AI use per calendar day (America/Sao_Paulo).
// The numeric value matches the owner directive; kept here (not in credits.ts)
// so allowance.ts is the single place for allowance business rules.
// Replace with config table (S5) when available.
export const FREE_TIER_DAILY_LIMIT = 1 as const;

// Subscription plan codes stored in subscriptions.plan (LOV-keyed).
export const PLAN_FREE = "free" as const;
export const PLAN_PAID = "paid" as const;
