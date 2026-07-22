// api/lib/ai-quota.ts
//
// Per-user daily AI-call quota. There is no other rate limit or spend cap in the
// stack, so every AI procedure that a student can trigger with free input MUST
// call assertAndIncrementQuota before enqueueing a relay job (the cost-commit
// point). Cache-first flows (getOrGenerateExplanation) stay unguarded — their
// cost is bounded by the global cache.

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { aiUsageDaily } from "../../drizzle/schema";

// Feature buckets keep independent counters — tutor usage must never exhaust
// the coach's (much smaller) budget.
export type AiQuotaKind = "tutor" | "coach";

// Atomically increment today's counter for `userId`+`kind` and throw FORBIDDEN
// when the post-increment count exceeds `limit`. The increment is a single
// upsert, so concurrent calls cannot slip past the limit.
export async function assertAndIncrementQuota(
  userId: string,
  kind: AiQuotaKind,
  limit: number,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .insert(aiUsageDaily)
    .values({ userId, day, kind, count: 1, createdBy: userId, lastUpdBy: userId })
    .onConflictDoUpdate({
      target: [aiUsageDaily.userId, aiUsageDaily.day, aiUsageDaily.kind],
      set: {
        count: sql`${aiUsageDaily.count} + 1`,
        lastUpdAt: new Date().toISOString(),
        lastUpdBy: userId,
      },
    })
    .returning({ count: aiUsageDaily.count });
  if (row === undefined || row.count > limit) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Limite diário de IA atingido. Tente novamente amanhã.",
    });
  }
}
