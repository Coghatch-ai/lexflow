// scripts/migrate.ts
//
// Applies drizzle migrations via drizzle-orm's programmatic migrate(). Preferred
// over `drizzle-kit migrate` because it gives real error messages on failure.
// Invoked by `pnpm db:migrate`.

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const DRIZZLE_DIR = "./drizzle";
const META_DIR = path.join(DRIZZLE_DIR, "meta");
const MARKER_PATH = path.join(META_DIR, "_applied.json");

// Records the sorted list of applied migration SQL filenames after a SUCCESSFUL
// apply. Per-machine local state (gitignored) — read by the push-guard to block
// pushing schema changes that were never migrated. Written atomically (unique
// temp file co-located in drizzle/meta so the rename is same-filesystem, then
// renamed over the target) so a failed/partial migrate can never leave a false
// marker. Errors propagate — the caller fails the whole run.
async function writeAppliedMarker(): Promise<void> {
  const entries = await fs.readdir(DRIZZLE_DIR);
  const applied = entries.filter((f) => f.endsWith(".sql")).sort();

  const tmpPath = path.join(META_DIR, `._applied.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmpPath, `${JSON.stringify(applied, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, MARKER_PATH);
}

async function main(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    const db = drizzle(pool);
    console.warn("[migrate] applying migrations from ./drizzle");
    await migrate(db, { migrationsFolder: "./drizzle" });
    await writeAppliedMarker();
    console.warn("[migrate] ✓ done");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[migrate] ✗ failed:", err);
  process.exit(1);
});
