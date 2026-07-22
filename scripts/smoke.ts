// scripts/smoke.ts
//
// End-to-end check of the protected data API against the real lexflow DB,
// without needing a Clerk JWT: it creates a throwaway "smoke" user, drives the
// routers via appRouter.createCaller, then deletes the user (FK cascade cleans
// up its sessions + answers). Run after `pnpm db:seed`. Invoked by `pnpm smoke`.

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { oabQuestions, users } from "../drizzle/schema";
import { appRouter } from "../api/trpc/router";

const SMOKE_EXTERNAL_ID = "smoke-test-user";

async function main(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  const db = drizzle(pool);
  let smokeUserId: string | undefined;

  try {
    const [u] = await db
      .insert(users)
      .values({ externalId: SMOKE_EXTERNAL_ID, email: "smoke@lexflow.test", name: "Smoke Test" })
      .onConflictDoUpdate({ target: users.externalId, set: { name: "Smoke Test" } })
      .returning({ id: users.id });
    if (u === undefined) throw new Error("smoke user upsert failed");
    smokeUserId = u.id;

    const caller = appRouter.createCaller({
      externalUserId: SMOKE_EXTERNAL_ID,
      userId: smokeUserId,
      role: "user",
    });

    const qs = await caller.questions.list({ limit: 5 });
    const first = qs[0];
    if (first === undefined) throw new Error("no questions — run `pnpm db:seed` first");
    console.warn(
      `[smoke] questions.list → ${qs.length} (e.g. "${first.questionText.slice(0, 48)}…")`,
    );

    const rec = await caller.sessions.record({
      discipline: first.discipline,
      difficulty: "medium",
      answers: qs.map((q, i) => ({
        questionId: q.id,
        userAnswer: q.options[0] ?? "",
        correct: i % 2 === 0,
        timeSpent: 30 + i,
      })),
    });
    console.warn(
      `[smoke] sessions.record → session ${rec.sessionId} (${rec.correctAnswers}/${rec.totalQuestions} correct)`,
    );

    const summary = await caller.stats.summary();
    console.warn("[smoke] stats.summary →", summary);

    const byDiscipline = await caller.stats.byDiscipline();
    console.warn(`[smoke] stats.byDiscipline → ${byDiscipline.length} discipline row(s)`);

    const recent = await caller.sessions.listRecent();
    console.warn(`[smoke] sessions.listRecent → ${recent.length} session(s)`);

    const byBoard = await caller.stats.byExamBoard();
    console.warn(`[smoke] stats.byExamBoard → ${byBoard.length} board row(s)`);

    const byTime = await caller.stats.byResponseTime();
    console.warn(`[smoke] stats.byResponseTime → ${byTime.length} bucket(s)`);

    const recurring = await caller.stats.recurringErrors();
    console.warn(`[smoke] stats.recurringErrors → ${recurring.length} row(s)`);

    const review = await caller.questions.reviewQueue();
    console.warn(`[smoke] questions.reviewQueue → ${review.length} question(s)`);

    const goal = await caller.goals.create({ discipline: first.discipline, targetAccuracy: 75 });
    const goalList = await caller.goals.list();
    console.warn(`[smoke] goals.create + list → ${goalList.length} goal(s) (new ${goal.id})`);
    await caller.goals.update({ id: goal.id, targetAccuracy: 80 });
    await caller.goals.delete({ id: goal.id });
    console.warn("[smoke] goals.update + delete OK");

    // Invariant: every oab_questions.discipline must be a valid DISCIPLINE LOV code.
    // This assertion catches any future CSV import that wrote a raw pt-BR label
    // instead of a code (the exact bug fixed in #46).
    const badDisciplineResult = await db.execute<{ bad_count: number }>(
      sql`SELECT count(*)::int AS bad_count
          FROM ${oabQuestions}
          WHERE discipline NOT IN (
            SELECT code FROM list_of_values WHERE type = 'DISCIPLINE'
          )`,
    );
    const badDisciplineCount = badDisciplineResult.rows[0]?.bad_count ?? 1;
    if (badDisciplineCount !== 0) {
      throw new Error(
        `[smoke] discipline invariant FAILED: ${String(badDisciplineCount)} oab_questions row(s) ` +
          `store a pt-BR label instead of a LOV code. Run the backfill migration (#46).`,
      );
    }
    console.warn("[smoke] discipline-code invariant ✓ (0 rows with raw label)");

    console.warn("[smoke] ✓ all protected procedures OK");
  } finally {
    if (smokeUserId !== undefined) {
      await db.delete(users).where(eq(users.id, smokeUserId));
      console.warn("[smoke] cleaned up smoke user (cascade removed sessions + answers)");
    }
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[smoke] ✗ failed:", err);
  process.exit(1);
});
