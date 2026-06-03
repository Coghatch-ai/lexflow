// api/db/scope.ts
//
// Scoped DB helper — every user-owned query MUST go through this. It enforces
// per-user isolation (user_id = ctx.userId). LexFlow is single-user B2C: there
// are no tenants. `users` and `oab_questions` are global (not user-scoped).
//
// Add a TABLE_SCOPE entry every time a table is added to drizzle/schema.ts —
// that map is the lever that keeps the safety rail in place as the schema grows.

import { eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

type ScopeType = { type: "user" } | { type: "global" };

const TABLE_SCOPE: Record<string, ScopeType> = {
  // Global (not user-scoped)
  users: { type: "global" },
  oab_questions: { type: "global" },
  list_of_values: { type: "global" },
  spaced_repetition_config: { type: "global" },

  // Per-user owned tables
  user_answers: { type: "user" },
  study_sessions: { type: "user" },
  user_performance_stats: { type: "user" },
  discipline_performance: { type: "user" },
  exam_board_performance: { type: "user" },
  user_goals: { type: "user" },
  goal_notifications: { type: "user" },
  user_question_states: { type: "user" },
};

function tableName(table: PgTable): string {
  const record = table as unknown as Record<string | symbol, unknown>;
  const internal = record["_"] as { name: string } | undefined;
  return (record[Symbol.for("drizzle:Name")] as string | undefined) ?? internal?.name ?? "";
}

export type ScopedDb = {
  readonly userId: string;
  /** WHERE condition scoping a table to the current user (user_id = ctx.userId). */
  conditions<T extends PgTable>(table: T): SQL;
  /** Inject userId into an insert payload for a user-owned table. */
  withUser<T extends Record<string, unknown>>(data: T): T & { userId: string };
};

export function createScopedDb({ userId }: { userId: string }): ScopedDb {
  return {
    userId,

    conditions<T extends PgTable>(table: T): SQL {
      const config = TABLE_SCOPE[tableName(table)];
      // Global tables carry no per-user filter. Returning `true` keeps every
      // call site uniform (always pass scope.conditions(table) to .where()).
      if (config === undefined || config.type === "global") {
        return sql`true`;
      }
      const columns = table as unknown as Record<string, unknown>;
      const userIdColumn = columns["userId"];
      if (userIdColumn === undefined) {
        throw new Error(`Table ${tableName(table)} is user-scoped but has no userId column`);
      }
      return eq(userIdColumn as SQL, userId);
    },

    withUser<T extends Record<string, unknown>>(data: T): T & { userId: string } {
      return { ...data, userId };
    },
  };
}
