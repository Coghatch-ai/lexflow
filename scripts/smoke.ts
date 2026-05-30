// scripts/smoke.ts
//
// End-to-end check of the protected data API against the real lexflow DB,
// without needing a Clerk JWT: it creates a throwaway "smoke" user, drives the
// routers via appRouter.createCaller, then deletes the user (FK cascade cleans
// up its sessions + answers). Run after `pnpm db:seed`. Invoked by `pnpm smoke`.

import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../drizzle/schema";
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
