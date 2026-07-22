// shared/data/discipline-map.ts
//
// Single source of truth for mapping raw pt-BR discipline labels (as stored by
// the CSV scraper) to English LOV codes. Used by:
//   - scripts/seed-from-csv.ts   (import guard on every row)
//   - drizzle backfill migration (generated UPDATE statements)
//   - shared/data/oab-questions.ts generator (DISCIPLINE_CODE_BY_VALUE)
//
// Rules (per CLAUDE.md business rules):
//   • oab_questions.discipline MUST store the English LOV code, never a pt-BR label.
//   • resolveDisciplineCode() throws on any label absent from this map — fail loud,
//     never silently write a raw label.

import { LOV_SEED } from "./lov";

// Exact LOV value → code (derived from LOV_SEED; kept in sync automatically).
const LOV_VALUE_TO_CODE: Record<string, string> = Object.fromEntries(
  LOV_SEED.filter((r) => r.type === "DISCIPLINE").map((r) => [r.value, r.code]),
);

// Verbose scraper aliases that don't match a LOV value exactly but map to an
// existing code. Key = exact string as stored by the CSV scraper.
const SCRAPER_ALIAS_TO_CODE: Record<string, string> = {
  // Verbose variants → existing code
  "Estatuto da Advocacia e da OAB, Regulamento Geral, Código de Ética e Disciplina e Estatuto da Caixa de Assistência dos Advogados":
    "LEGAL_ETHICS",
  "Direito Processual Civil - Novo CPC 2015": "CIVIL_PROCEDURE",
  "Direito Processual Penal": "CRIMINAL_PROCEDURE",
  "Direito Processual do Trabalho": "LABOR_PROCEDURE",
  "Direito Empresarial (Comercial)": "COMMERCIAL_LAW",
  "Direito da Criança e do Adolescente - ECA (Estatuto da Criança e do Adolescente)":
    "CHILD_ADOLESCENT_LAW",
  // Internacional merge (user decision: both → INTERNATIONAL_LAW)
  "Direito Internacional Público": "INTERNATIONAL_LAW",
  "Direito Internacional Privado": "INTERNATIONAL_LAW",
};

/**
 * Resolve a raw scraper discipline label to its English LOV code.
 *
 * Lookup order:
 *   1. Exact LOV value match (e.g. "Direito Civil" → "CIVIL_LAW").
 *   2. Scraper alias match (verbose variants + international merge).
 *
 * Throws if the label is not found in either map — this is intentional.
 * A missing mapping means the CSV contains a discipline that has not been
 * approved as a LOV code; adding it silently would violate the code/label
 * invariant. Fix: add the alias to SCRAPER_ALIAS_TO_CODE above, or add a
 * new row to shared/data/lov.ts and re-run `pnpm db:seed-lov`.
 */
export function resolveDisciplineCode(label: string): string {
  const fromLov = LOV_VALUE_TO_CODE[label];
  if (fromLov !== undefined) return fromLov;

  const fromAlias = SCRAPER_ALIAS_TO_CODE[label];
  if (fromAlias !== undefined) return fromAlias;

  throw new Error(
    `[discipline-map] unmapped discipline label: "${label}". ` +
      `Add it to SCRAPER_ALIAS_TO_CODE in shared/data/discipline-map.ts ` +
      `(or add a new row to shared/data/lov.ts and re-run pnpm db:seed-lov).`,
  );
}

/**
 * All valid DISCIPLINE codes (derived from LOV_SEED). Useful for invariant
 * checks in tests without importing LOV_SEED directly.
 */
export const DISCIPLINE_CODES: ReadonlySet<string> = new Set(
  LOV_SEED.filter((r) => r.type === "DISCIPLINE").map((r) => r.code),
);

/**
 * Full label→code map combining LOV values + scraper aliases.
 * Exported for use in migration SQL generation (see drizzle backfill migration).
 */
export const FULL_DISCIPLINE_LABEL_TO_CODE: ReadonlyMap<string, string> = new Map([
  ...Object.entries(LOV_VALUE_TO_CODE),
  ...Object.entries(SCRAPER_ALIAS_TO_CODE),
]);
