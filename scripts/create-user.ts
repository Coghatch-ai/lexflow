// scripts/create-user.ts
//
// Manually create (or update) a local `users` row for a Clerk user. The POC has
// no Clerk webhook, so this is how a signed-up Clerk user gets their local row
// (needed by protectedProcedure). Find the Clerk user id in the Clerk Dashboard.
//
//   pnpm db:create-user <clerk-user-id> [email] [name...]

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../drizzle/schema";

async function main(): Promise<void> {
  const [externalId, email, ...nameParts] = process.argv.slice(2);
  if (externalId === undefined || externalId.length === 0) {
    console.error("usage: pnpm db:create-user <clerk-user-id> [email] [name...]");
    process.exit(1);
  }
  const name = nameParts.length > 0 ? nameParts.join(" ") : null;
  const emailValue = email ?? null;

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });

  try {
    const db = drizzle(pool);
    const [row] = await db
      .insert(users)
      .values({ externalId, email: emailValue, name })
      .onConflictDoUpdate({
        target: users.externalId,
        set: { email: emailValue, name, lastUpdAt: new Date().toISOString() },
      })
      .returning({ id: users.id, externalId: users.externalId });
    console.warn(`[create-user] ✓ users.id=${row?.id} external_id=${externalId}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[create-user] ✗ failed:", err);
  process.exit(1);
});
