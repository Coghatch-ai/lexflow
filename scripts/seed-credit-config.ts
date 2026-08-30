// scripts/seed-credit-config.ts
//
// Seeds the billing MULTIPLIER rows (`mult.<source>`) in credit_config — the ONE
// place margin lives (#98). The cost-of-goods table holds TRUE provider cost
// only; this script is what turns cost into price.
//
// ORDER OF OPERATIONS MATTERS. Run this AFTER the code that carries the true-cost
// rate table is deployed, NEVER before: seeding 1.2× on top of the OLD
// margin-inflated table would bill the margin twice (an overcharge window).
//
// Idempotent: upsert by `key` (onConflictDoUpdate), so re-running is a no-op when
// the values already match. No DDL ⇒ no migration.
//
// Usage:  pnpm db:seed-credit-config

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { creditConfig } from "../drizzle/schema";

// ×100 fixed point: 120 = 1.2× = a 20% margin over true provider cost. The four
// spend sources are the only callers of consumeAndCharge (api/lib/ai-metering.ts).
const MULT_X100 = 120;

const ROWS: ReadonlyArray<{ key: string; valueInt: number; description: string }> = [
  { key: "mult.grade", valueInt: MULT_X100, description: "Margem 2ª fase (correção discursiva)" },
  { key: "mult.explanation", valueInt: MULT_X100, description: "Margem explicação de questão" },
  { key: "mult.tutor", valueInt: MULT_X100, description: "Margem tutor" },
  { key: "mult.coach", valueInt: MULT_X100, description: "Margem coach" },
];

async function main(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const db = drizzle(pool);
    console.warn(`[seed-credit-config] upserting ${ROWS.length} mult.* rows (${MULT_X100}/100 ×)`);
    for (const row of ROWS) {
      await db
        .insert(creditConfig)
        .values(row)
        .onConflictDoUpdate({
          target: creditConfig.key,
          set: { valueInt: row.valueInt, description: row.description },
        });
      console.warn(`[seed-credit-config]   ${row.key} = ${String(row.valueInt)}`);
    }
    console.warn("[seed-credit-config] ✓ credit_config multipliers synced");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[seed-credit-config] ✗ failed:", err);
  process.exit(1);
});
