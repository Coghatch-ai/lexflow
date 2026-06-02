// scripts/make-admin.ts
//
// Promotes a local users row to role="admin" by Clerk external_id.
//
//   pnpm db:make-admin <clerk-user-id>

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";

async function main(): Promise<void> {
  const [externalId] = process.argv.slice(2);
  if (externalId === undefined || externalId.length === 0) {
    console.error("usage: pnpm db:make-admin <clerk-user-id>");
    process.exit(1);
  }

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });

  try {
    const db = drizzle(pool);
    const updated = await db
      .update(users)
      .set({ role: "admin", lastUpdAt: new Date().toISOString() })
      .where(eq(users.externalId, externalId))
      .returning({ id: users.id, externalId: users.externalId, role: users.role });

    if (updated.length === 0) {
      console.error(`[make-admin] ✗ no users row found for external_id=${externalId}`);
      console.error("  Run pnpm db:create-user first.");
      process.exit(1);
    }

    console.warn(`[make-admin] ✓ users.id=${updated[0]?.id} external_id=${externalId} role=admin`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[make-admin] ✗ failed:", err);
  process.exit(1);
});
