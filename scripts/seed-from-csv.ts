// scripts/seed-from-csv.ts
//
// Seeds oab_questions from a CSV produced by the ba/ Playwright scraper.
// Usage:  pnpm db:seed-csv <path-to-questions.csv>
// Idempotent: uses onConflictDoUpdate so re-running updates changed rows.

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { oabQuestions } from "../drizzle/schema";

interface CsvRow {
  question_id: string;
  year: string;
  banca: string;
  orgao: string;
  prova: string;
  phase: string;
  discipline: string;
  topic: string;
  enunciation: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  legal_basis: string;
  gabarito_comentado: string;
}

function toInsertRow(r: CsvRow) {
  const options = [r.option_a, r.option_b, r.option_c, r.option_d, r.option_e].filter(Boolean);
  return {
    id: r.question_id,
    questionText: r.enunciation,
    options,
    correctAnswer: r.correct_answer,
    legalBasis: r.legal_basis.length > 0 ? r.legal_basis : null,
    explanation: r.gabarito_comentado,
    legislationLink: null,
    legislationTitle: null,
    difficulty: "medium" as const,
    discipline: r.discipline,
    topic: r.topic,
    examBoard: r.banca,
    year: parseInt(r.year, 10),
    phase: r.phase.length > 0 ? r.phase : "1st",
  };
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (csvPath === undefined || csvPath.length === 0) {
    console.error("Usage: pnpm db:seed-csv <path-to-questions.csv>");
    process.exit(1);
  }

  const absolute = path.resolve(csvPath);
  if (!fs.existsSync(absolute)) {
    console.error(`File not found: ${absolute}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absolute, "utf-8");
  const rows = parse(content, { columns: true, skip_empty_lines: true }) as unknown as CsvRow[];
  console.warn(`[seed-csv] parsed ${rows.length} rows from ${absolute}`);

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`;

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const db = drizzle(pool);
    const records = rows.map(toInsertRow);

    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      await db
        .insert(oabQuestions)
        .values(records.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: oabQuestions.id,
          set: {
            questionText: sql`excluded.question_text`,
            options: sql`excluded.options`,
            correctAnswer: sql`excluded.correct_answer`,
            legalBasis: sql`excluded.legal_basis`,
            explanation: sql`excluded.explanation`,
            difficulty: sql`excluded.difficulty`,
            discipline: sql`excluded.discipline`,
            topic: sql`excluded.topic`,
            examBoard: sql`excluded.exam_board`,
            year: sql`excluded.year`,
            phase: sql`excluded.phase`,
            lastUpdAt: new Date().toISOString(),
          },
        });
      inserted += Math.min(BATCH, records.length - i);
      console.warn(`[seed-csv] upserted ${inserted}/${records.length}`);
    }

    const count = await db.select({ count: sql<number>`count(*)::int` }).from(oabQuestions);
    console.warn(`[seed-csv] ✓ oab_questions now has ${count[0]?.count ?? 0} rows`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[seed-csv] ✗ failed:", err);
  process.exit(1);
});
