// scripts/db-query.ts
//
// Ad-hoc READ-ONLY SQL against the lexflow DB. For verification/inspection only
// (e.g. "what 2ª-fase exams are imported?"). Reuses api/db/client, so it picks
// up DB_* / DATABASE_URL from .env exactly like the app does.
//
// READ-ONLY by design: only SELECT / WITH / EXPLAIN / SHOW are allowed. Schema
// changes go through db:generate -> review -> db:migrate (NEVER manual SQL).
//
// Usage:
//   pnpm db:query "SELECT exam_label, area FROM oab_discursive_imports ORDER BY 1"
//   pnpm db:query --json "SELECT count(*) n FROM oab_questions"

import "dotenv/config";
import { query } from "../api/db/client";

const READ_ONLY = /^\s*(select|with|explain|show)\b/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const sql = args
    .filter((a) => a !== "--json")
    .join(" ")
    .trim();

  if (sql.length === 0) {
    console.warn('Usage: pnpm db:query [--json] "SELECT ..."');
    process.exit(1);
  }
  if (!READ_ONLY.test(sql)) {
    console.warn(
      "Refused: db:query is read-only (SELECT/WITH/EXPLAIN/SHOW only).\n" +
        "Schema changes go through db:generate -> db:migrate.",
    );
    process.exit(1);
  }

  const rows = await query<Record<string, unknown>>(sql);

  if (asJson) {
    console.warn(JSON.stringify(rows, null, 2));
  } else if (rows.length === 0) {
    console.warn("(0 rows)");
  } else {
    const cols = Object.keys(rows[0] ?? {});
    const cell = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
        return v.toString();
      return JSON.stringify(v);
    };
    const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
    const fmt = (vals: string[]): string => vals.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ");
    console.warn(fmt(cols));
    console.warn(widths.map((w) => "-".repeat(w)).join("  "));
    for (const r of rows) console.warn(fmt(cols.map((c) => cell(r[c]))));
    console.warn(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
