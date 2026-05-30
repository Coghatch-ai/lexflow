// scripts/seed.ts
//
// Seeds the global oab_questions catalog. Idempotent: re-running inserts only
// missing rows (onConflictDoNothing on the id PK). Invoked by `pnpm db:seed`.

import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { listOfValues, oabQuestions } from "../drizzle/schema";
import { generateOabQuestions } from "../shared/data/oab-questions";
import { LOV_SEED } from "../shared/data/lov";

async function main(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const db = drizzle(pool);
    const questions = generateOabQuestions();
    console.warn(`[seed] upserting ${questions.length} oab_questions (idempotent)`);

    const BATCH = 100;
    for (let i = 0; i < questions.length; i += BATCH) {
      await db
        .insert(oabQuestions)
        .values(questions.slice(i, i + BATCH))
        .onConflictDoNothing();
    }

    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(oabQuestions);
    console.warn(`[seed] ✓ oab_questions now has ${rows[0]?.count ?? 0} rows`);

    console.warn(`[seed] upserting ${LOV_SEED.length} list_of_values (idempotent)`);
    await db
      .insert(listOfValues)
      .values(
        LOV_SEED.map((r) => ({
          type: r.type,
          code: r.code,
          value: r.value,
          sortOrder: r.sortOrder,
        })),
      )
      .onConflictDoNothing();
    const lovRows = await db.select({ count: sql<number>`count(*)::int` }).from(listOfValues);
    console.warn(`[seed] ✓ list_of_values now has ${lovRows[0]?.count ?? 0} rows`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[seed] ✗ failed:", err);
  process.exit(1);
});
