// scripts/seed-lov.ts
//
// Syncs ONLY the list_of_values picklists from shared/data/lov.ts — without
// touching the oab_questions catalog (that's `pnpm db:seed`). Use this to push
// new/changed picklists (e.g. QUESTION_TYPE) to the DB. Deterministic
// delete-all + insert, so removed codes don't leave stale rows. LOV has no FK
// references, so this is safe.
//
// Usage:  pnpm db:seed-lov

import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { listOfValues } from "../drizzle/schema";
import { LOV_SEED } from "../shared/data/lov";

async function main(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const db = drizzle(pool);
    console.warn(`[seed-lov] syncing ${LOV_SEED.length} list_of_values`);
    await db.delete(listOfValues);
    await db.insert(listOfValues).values(
      LOV_SEED.map((r) => ({
        type: r.type,
        code: r.code,
        value: r.value,
        sortOrder: r.sortOrder,
      })),
    );
    const byType = await db
      .select({ type: listOfValues.type, count: sql<number>`count(*)::int` })
      .from(listOfValues)
      .groupBy(listOfValues.type);
    for (const t of byType) console.warn(`[seed-lov]   ${t.type}: ${t.count}`);
    console.warn(`[seed-lov] ✓ list_of_values synced`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[seed-lov] ✗ failed:", err);
  process.exit(1);
});
