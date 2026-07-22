// shared/data/lov.ts
//
// Seed data for the list_of_values picklist catalog. The CODE is the English
// identifier stored in domain tables and used in app logic; the VALUE is the
// pt-BR label shown to users. Add a row here + re-run `pnpm db:seed` to extend
// a picklist — never hardcode a pt-BR string in components or the API.

export type LovType =
  | "DISCIPLINE"
  | "DIFFICULTY"
  | "EXAM_BOARD"
  | "PHASE"
  | "QUESTION_TYPE"
  | "PLAN_DEADLINE";

export type LovSeedRow = {
  type: LovType;
  code: string;
  value: string;
  sortOrder: number;
};

export const LOV_SEED: LovSeedRow[] = [
  // Disciplines (value matches the canonical pt-BR names used in OAB 1ª Fase)
  // sortOrder reflects pt-BR alphabetical order by value (localeCompare 'pt-BR')
  // sortOrder reflects pt-BR alphabetical order by value (localeCompare 'pt-BR')
  { type: "DISCIPLINE", code: "EXTERNAL_CONTROL", value: "Controle Externo", sortOrder: 1 },
  { type: "DISCIPLINE", code: "ADMINISTRATIVE_LAW", value: "Direito Administrativo", sortOrder: 2 },
  { type: "DISCIPLINE", code: "ENVIRONMENTAL_LAW", value: "Direito Ambiental", sortOrder: 3 },
  { type: "DISCIPLINE", code: "CIVIL_LAW", value: "Direito Civil", sortOrder: 4 },
  { type: "DISCIPLINE", code: "CONSTITUTIONAL_LAW", value: "Direito Constitucional", sortOrder: 5 },
  { type: "DISCIPLINE", code: "DIGITAL_LAW", value: "Direito Digital", sortOrder: 6 },
  { type: "DISCIPLINE", code: "CONSUMER_LAW", value: "Direito do Consumidor", sortOrder: 7 },
  { type: "DISCIPLINE", code: "LABOR_LAW", value: "Direito do Trabalho", sortOrder: 8 },
  { type: "DISCIPLINE", code: "ECONOMIC_LAW", value: "Direito Econômico", sortOrder: 9 },
  { type: "DISCIPLINE", code: "ELECTORAL_LAW", value: "Direito Eleitoral", sortOrder: 10 },
  { type: "DISCIPLINE", code: "COMMERCIAL_LAW", value: "Direito Empresarial", sortOrder: 11 },
  { type: "DISCIPLINE", code: "FINANCIAL_LAW", value: "Direito Financeiro", sortOrder: 12 },
  { type: "DISCIPLINE", code: "INTERNATIONAL_LAW", value: "Direito Internacional", sortOrder: 13 },
  {
    type: "DISCIPLINE",
    code: "NOTARY_REGISTRY_LAW",
    value: "Direito Notarial e Registral",
    sortOrder: 14,
  },
  { type: "DISCIPLINE", code: "CRIMINAL_LAW", value: "Direito Penal", sortOrder: 15 },
  {
    type: "DISCIPLINE",
    code: "SOCIAL_SECURITY_LAW",
    value: "Direito Previdenciário",
    sortOrder: 16,
  },
  { type: "DISCIPLINE", code: "TAX_LAW", value: "Direito Tributário", sortOrder: 17 },
  { type: "DISCIPLINE", code: "URBAN_LAW", value: "Direito Urbanístico", sortOrder: 18 },
  { type: "DISCIPLINE", code: "HUMAN_RIGHTS", value: "Direitos Humanos", sortOrder: 19 },
  {
    type: "DISCIPLINE",
    code: "CHILD_ADOLESCENT_LAW",
    value: "ECA - Estatuto da Criança e do Adolescente",
    sortOrder: 20,
  },
  {
    type: "DISCIPLINE",
    code: "DISABLED_PERSON_STATUTE",
    value: "Estatuto da Pessoa com Deficiência",
    sortOrder: 21,
  },
  {
    type: "DISCIPLINE",
    code: "ELDERLY_PERSON_STATUTE",
    value: "Estatuto da Pessoa Idosa",
    sortOrder: 22,
  },
  { type: "DISCIPLINE", code: "LEGAL_ETHICS", value: "Ética Profissional", sortOrder: 23 },
  { type: "DISCIPLINE", code: "PHILOSOPHY", value: "Filosofia", sortOrder: 24 },
  { type: "DISCIPLINE", code: "LEGAL_PHILOSOPHY", value: "Filosofia do Direito", sortOrder: 25 },
  {
    type: "DISCIPLINE",
    code: "TRAFFIC_LEGISLATION",
    value: "Legislação de Trânsito",
    sortOrder: 26,
  },
  { type: "DISCIPLINE", code: "FEDERAL_LEGISLATION", value: "Legislação Federal", sortOrder: 27 },
  { type: "DISCIPLINE", code: "CIVIL_PROCEDURE", value: "Processo Civil", sortOrder: 28 },
  { type: "DISCIPLINE", code: "LABOR_PROCEDURE", value: "Processo do Trabalho", sortOrder: 29 },
  { type: "DISCIPLINE", code: "CRIMINAL_PROCEDURE", value: "Processo Penal", sortOrder: 30 },
  { type: "DISCIPLINE", code: "SOCIOLOGY", value: "Sociologia", sortOrder: 31 },

  // Difficulty
  { type: "DIFFICULTY", code: "easy", value: "Fácil", sortOrder: 1 },
  { type: "DIFFICULTY", code: "medium", value: "Médio", sortOrder: 2 },
  { type: "DIFFICULTY", code: "hard", value: "Difícil", sortOrder: 3 },

  // Exam board (proper nouns — code == value)
  { type: "EXAM_BOARD", code: "FGV", value: "FGV", sortOrder: 1 },
  { type: "EXAM_BOARD", code: "CESPE", value: "CESPE", sortOrder: 2 },

  // Exam phase
  { type: "PHASE", code: "1st", value: "1ª Fase", sortOrder: 1 },
  { type: "PHASE", code: "2nd", value: "2ª Fase", sortOrder: 2 },

  // Question type (2ª fase / discursive support — oab_discursive_questions)
  { type: "QUESTION_TYPE", code: "PECA_PRATICA", value: "Peça Prático-Profissional", sortOrder: 1 },
  { type: "QUESTION_TYPE", code: "DISCURSIVE", value: "Questão Discursiva", sortOrder: 2 },

  // Study plan deadlines (code is the number of days as a string)
  { type: "PLAN_DEADLINE", code: "15", value: "15 dias", sortOrder: 1 },
  { type: "PLAN_DEADLINE", code: "30", value: "30 dias", sortOrder: 2 },
  { type: "PLAN_DEADLINE", code: "45", value: "45 dias", sortOrder: 3 },
  { type: "PLAN_DEADLINE", code: "60", value: "60 dias", sortOrder: 4 },
  { type: "PLAN_DEADLINE", code: "90", value: "90 dias", sortOrder: 5 },
  { type: "PLAN_DEADLINE", code: "120", value: "120 dias", sortOrder: 6 },
];
