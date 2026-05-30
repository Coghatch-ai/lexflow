// shared/data/lov.ts
//
// Seed data for the list_of_values picklist catalog. The CODE is the English
// identifier stored in domain tables and used in app logic; the VALUE is the
// pt-BR label shown to users. Add a row here + re-run `pnpm db:seed` to extend
// a picklist — never hardcode a pt-BR string in components or the API.

export type LovType = "DISCIPLINE" | "DIFFICULTY" | "EXAM_BOARD" | "PHASE";

export type LovSeedRow = {
  type: LovType;
  code: string;
  value: string;
  sortOrder: number;
};

export const LOV_SEED: LovSeedRow[] = [
  // Disciplines (value matches the canonical pt-BR names)
  { type: "DISCIPLINE", code: "CONSTITUTIONAL_LAW", value: "Direito Constitucional", sortOrder: 1 },
  { type: "DISCIPLINE", code: "CIVIL_LAW", value: "Direito Civil", sortOrder: 2 },
  { type: "DISCIPLINE", code: "CRIMINAL_LAW", value: "Direito Penal", sortOrder: 3 },
  { type: "DISCIPLINE", code: "CIVIL_PROCEDURE", value: "Direito Processual Civil", sortOrder: 4 },
  {
    type: "DISCIPLINE",
    code: "CRIMINAL_PROCEDURE",
    value: "Direito Processual Penal",
    sortOrder: 5,
  },
  { type: "DISCIPLINE", code: "ADMINISTRATIVE_LAW", value: "Direito Administrativo", sortOrder: 6 },
  { type: "DISCIPLINE", code: "TAX_LAW", value: "Direito Tributário", sortOrder: 7 },
  { type: "DISCIPLINE", code: "LABOR_LAW", value: "Direito Trabalhista", sortOrder: 8 },
  { type: "DISCIPLINE", code: "COMMERCIAL_LAW", value: "Direito Comercial", sortOrder: 9 },
  { type: "DISCIPLINE", code: "ENVIRONMENTAL_LAW", value: "Direito Ambiental", sortOrder: 10 },
  { type: "DISCIPLINE", code: "LEGAL_ETHICS", value: "Ética Profissional", sortOrder: 11 },

  // Difficulty
  { type: "DIFFICULTY", code: "EASY", value: "Fácil", sortOrder: 1 },
  { type: "DIFFICULTY", code: "MEDIUM", value: "Médio", sortOrder: 2 },
  { type: "DIFFICULTY", code: "HARD", value: "Difícil", sortOrder: 3 },

  // Exam board (proper nouns — code == value)
  { type: "EXAM_BOARD", code: "FGV", value: "FGV", sortOrder: 1 },
  { type: "EXAM_BOARD", code: "CESPE", value: "CESPE", sortOrder: 2 },

  // Exam phase
  { type: "PHASE", code: "FIRST", value: "1ª Fase", sortOrder: 1 },
  { type: "PHASE", code: "SECOND", value: "2ª Fase", sortOrder: 2 },
];
