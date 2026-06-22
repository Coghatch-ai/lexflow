// scripts/import-2fase-save.ts
//
// Step 2 of the OAB 2ª-fase import: read a reviewed draft JSON (produced by
// import-2fase-extract.ts and edited by a human) and upsert it into
// oab_discursive_questions. Idempotent: ids are deterministic (toRows), so
// re-running updates rows in place via onConflictDoUpdate.
//
// Usage:  pnpm import:2fase:save scripts/out/xl-civil_law.draft.json

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { oabDiscursiveImports, oabDiscursiveQuestions } from "../drizzle/schema";
import { discursiveDraftSchema, toImportRow, toRows } from "../shared/domain/discursive-question";

async function main(): Promise<void> {
  const draftPath = process.argv[2];
  if (draftPath === undefined || draftPath.length === 0) {
    console.error("Usage: pnpm import:2fase:save <path-to-draft.json>");
    process.exit(1);
    return;
  }

  const absolute = path.resolve(draftPath);
  if (!fs.existsSync(absolute)) {
    console.error(`File not found: ${absolute}`);
    process.exit(1);
    return;
  }

  const draft = discursiveDraftSchema.parse(JSON.parse(fs.readFileSync(absolute, "utf-8")));
  const records = toRows(draft);
  console.warn(`[save] ${records.length} rows for ${draft.examLabel} / ${draft.area}`);

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const db = drizzle(pool);

    const BATCH = 100;
    let upserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      await db
        .insert(oabDiscursiveQuestions)
        .values(records.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: oabDiscursiveQuestions.id,
          set: {
            examLabel: sql`excluded.exam_label`,
            examBoard: sql`excluded.exam_board`,
            year: sql`excluded.year`,
            phase: sql`excluded.phase`,
            area: sql`excluded.area`,
            questionType: sql`excluded.question_type`,
            orderIndex: sql`excluded.order_index`,
            statement: sql`excluded.statement`,
            modelAnswer: sql`excluded.model_answer`,
            maxPoints: sql`excluded.max_points`,
            maxLines: sql`excluded.max_lines`,
            legalBasis: sql`excluded.legal_basis`,
            topic: sql`excluded.topic`,
            lastUpdAt: new Date().toISOString(),
          },
        });
      upserted += Math.min(BATCH, records.length - i);
      console.warn(`[save] upserted ${upserted}/${records.length}`);
    }

    const count = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(oabDiscursiveQuestions);
    console.warn(`[save] ✓ oab_discursive_questions now has ${count[0]?.count ?? 0} rows`);

    // Record/refresh the import-tracking row (admin "what's already extracted").
    const imp = toImportRow(draft);
    await db
      .insert(oabDiscursiveImports)
      .values(imp)
      .onConflictDoUpdate({
        target: oabDiscursiveImports.id,
        set: {
          examLabel: sql`excluded.exam_label`,
          examBoard: sql`excluded.exam_board`,
          year: sql`excluded.year`,
          phase: sql`excluded.phase`,
          area: sql`excluded.area`,
          itemCount: sql`excluded.item_count`,
          modelAnswerCount: sql`excluded.model_answer_count`,
          provaUrl: sql`excluded.prova_url`,
          padraoUrl: sql`excluded.padrao_url`,
          lastUpdAt: new Date().toISOString(),
        },
      });
    console.warn(
      `[save] ✓ tracked import ${imp.id} (${imp.itemCount} items, ${imp.modelAnswerCount} with padrão)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[save] ✗ failed:", err);
  process.exit(1);
});
