// scripts/lib/smoke-drafts.ts
//
// The plumbing the `exam_drafts` smoke assertions share (epic #67 S2a): the
// caller/db aliases, the failing `check`, the per-user row count and the
// "did it raise this tRPC code" helper. Extracted so the assertions can live in
// more than one file — `smoke-exam-drafts.ts` was at the 500-line cap — without
// two copies of the plumbing drifting apart.

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { TRPCError } from "@trpc/server";
import type { appRouter } from "../../api/trpc/router";
import type { examDrafts, studySessions, userAnswers } from "../../drizzle/schema";

export type SmokeDb = NodePgDatabase<Record<string, never>>;
export type SmokeCaller = ReturnType<typeof appRouter.createCaller>;
export type SmokeQuestion = { id: string; options: string[]; discipline: string };

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[smoke] exam_drafts FAILED: ${message}`);
}

/** Row count for one user in any of the per-user tables these blocks touch. */
export async function countRows(
  db: SmokeDb,
  table: typeof examDrafts | typeof studySessions | typeof userAnswers,
  userId: string,
): Promise<number> {
  const rows = await db.select({ id: table.id }).from(table).where(eq(table.userId, userId));
  return rows.length;
}

/** Runs `fn` and reports whether it raised a TRPCError with `code`. */
export async function raises(
  code: TRPCError["code"],
  fn: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err: unknown) {
    if (err instanceof TRPCError && err.code === code) return true;
    throw err;
  }
}
