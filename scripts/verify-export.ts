import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { oabQuestions } from "../drizzle/schema";

async function main() {
  const pool = new Pool({
    connectionString:
      process.env["DATABASE_URL"] ??
      `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}/${process.env["DB_NAME"]}`,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  const db = drizzle(pool);

  const [[total], [noExp], [noAns], [noDisc], [noLegal], byBoard, byYear, sample] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(oabQuestions),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .where(sql`explanation is null or explanation = ''`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .where(sql`correct_answer = ''`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .where(sql`discipline = ''`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .where(sql`legal_basis is null`),
      db
        .select({ board: oabQuestions.examBoard, n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .groupBy(oabQuestions.examBoard),
      db
        .select({ year: oabQuestions.year, n: sql<number>`count(*)::int` })
        .from(oabQuestions)
        .groupBy(oabQuestions.year)
        .orderBy(oabQuestions.year),
      db
        .select({
          id: oabQuestions.id,
          year: oabQuestions.year,
          board: oabQuestions.examBoard,
          discipline: oabQuestions.discipline,
          answer: oabQuestions.correctAnswer,
          legalBasis: oabQuestions.legalBasis,
        })
        .from(oabQuestions)
        .orderBy(sql`id desc`)
        .limit(3),
    ]);

  console.warn("── oab_questions ──────────────────────────");
  console.warn(`total rows      : ${total?.n}`);
  console.warn(`no explanation  : ${noExp?.n}`);
  console.warn(`no answer       : ${noAns?.n}`);
  console.warn(`no discipline   : ${noDisc?.n}`);
  console.warn(`null legal_basis: ${noLegal?.n}`);
  console.warn("\nby exam board:");
  byBoard.forEach((r) => {
    console.warn(`  ${r.board.padEnd(8)} ${r.n}`);
  });
  console.warn("\nby year:");
  byYear.forEach((r) => {
    console.warn(`  ${r.year}  ${r.n}`);
  });
  console.warn("\nsample (3 newest ids):");
  sample.forEach((r) => {
    console.warn(" ", JSON.stringify(r));
  });

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
