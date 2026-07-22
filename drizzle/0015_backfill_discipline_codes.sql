-- drizzle/0015_backfill_discipline_codes.sql
--
-- One-time backfill (issue #46): normalize oab_questions.discipline from raw
-- pt-BR scraper labels to English LOV codes.
--
-- Root cause: scripts/seed-from-csv.ts wrote r.discipline (raw CSV label)
-- without mapping to a LOV code. The 1938 production rows store pt-BR labels;
-- the UI filters/stats compare against LOV codes → 0 results.
--
-- Map covers all 32 distinct stored labels (verified on live prod RDS):
--   • 13 exact LOV value matches
--   • 6 verbose scraper variants → existing code
--   • 2 internacional labels → INTERNATIONAL_LAW (product decision: merge)
--   • 11 new LOV codes (added to shared/data/lov.ts in this same change)
--
-- Acceptance: after applying this migration + pnpm db:seed-lov:
--   SELECT count(*) FROM oab_questions
--   WHERE discipline NOT IN (SELECT code FROM list_of_values WHERE type='DISCIPLINE')
--   → 0 (was 1938)

-- Exact LOV value → code (13 labels)
UPDATE "oab_questions" SET "discipline" = 'CONSTITUTIONAL_LAW'  WHERE "discipline" = 'Direito Constitucional';
UPDATE "oab_questions" SET "discipline" = 'CIVIL_LAW'           WHERE "discipline" = 'Direito Civil';
UPDATE "oab_questions" SET "discipline" = 'CRIMINAL_LAW'        WHERE "discipline" = 'Direito Penal';
UPDATE "oab_questions" SET "discipline" = 'LABOR_LAW'           WHERE "discipline" = 'Direito do Trabalho';
UPDATE "oab_questions" SET "discipline" = 'TAX_LAW'             WHERE "discipline" = 'Direito Tributário';
UPDATE "oab_questions" SET "discipline" = 'ADMINISTRATIVE_LAW'  WHERE "discipline" = 'Direito Administrativo';
UPDATE "oab_questions" SET "discipline" = 'HUMAN_RIGHTS'        WHERE "discipline" = 'Direitos Humanos';
UPDATE "oab_questions" SET "discipline" = 'CONSUMER_LAW'        WHERE "discipline" = 'Direito do Consumidor';
UPDATE "oab_questions" SET "discipline" = 'ENVIRONMENTAL_LAW'   WHERE "discipline" = 'Direito Ambiental';
UPDATE "oab_questions" SET "discipline" = 'LEGAL_PHILOSOPHY'    WHERE "discipline" = 'Filosofia do Direito';
UPDATE "oab_questions" SET "discipline" = 'ELECTORAL_LAW'       WHERE "discipline" = 'Direito Eleitoral';
UPDATE "oab_questions" SET "discipline" = 'SOCIAL_SECURITY_LAW' WHERE "discipline" = 'Direito Previdenciário';
UPDATE "oab_questions" SET "discipline" = 'FINANCIAL_LAW'       WHERE "discipline" = 'Direito Financeiro';

-- Verbose scraper variants → existing code (6 labels)
UPDATE "oab_questions" SET "discipline" = 'LEGAL_ETHICS'
  WHERE "discipline" = 'Estatuto da Advocacia e da OAB, Regulamento Geral, Código de Ética e Disciplina e Estatuto da Caixa de Assistência dos Advogados';
UPDATE "oab_questions" SET "discipline" = 'CIVIL_PROCEDURE'
  WHERE "discipline" = 'Direito Processual Civil - Novo CPC 2015';
UPDATE "oab_questions" SET "discipline" = 'CRIMINAL_PROCEDURE'
  WHERE "discipline" = 'Direito Processual Penal';
UPDATE "oab_questions" SET "discipline" = 'LABOR_PROCEDURE'
  WHERE "discipline" = 'Direito Processual do Trabalho';
UPDATE "oab_questions" SET "discipline" = 'COMMERCIAL_LAW'
  WHERE "discipline" = 'Direito Empresarial (Comercial)';
UPDATE "oab_questions" SET "discipline" = 'CHILD_ADOLESCENT_LAW'
  WHERE "discipline" = 'Direito da Criança e do Adolescente - ECA (Estatuto da Criança e do Adolescente)';

-- Internacional merge: Público + Privado → INTERNATIONAL_LAW (product decision)
UPDATE "oab_questions" SET "discipline" = 'INTERNATIONAL_LAW'
  WHERE "discipline" = 'Direito Internacional Público';
UPDATE "oab_questions" SET "discipline" = 'INTERNATIONAL_LAW'
  WHERE "discipline" = 'Direito Internacional Privado';

-- New LOV codes (11 disciplines, added to shared/data/lov.ts in this change)
-- Run `pnpm db:seed-lov` after `pnpm db:migrate` to insert these into list_of_values.
UPDATE "oab_questions" SET "discipline" = 'FEDERAL_LEGISLATION'    WHERE "discipline" = 'Legislação Federal';
UPDATE "oab_questions" SET "discipline" = 'DIGITAL_LAW'            WHERE "discipline" = 'Direito Digital';
UPDATE "oab_questions" SET "discipline" = 'DISABLED_PERSON_STATUTE' WHERE "discipline" = 'Estatuto da Pessoa com Deficiência';
UPDATE "oab_questions" SET "discipline" = 'SOCIOLOGY'              WHERE "discipline" = 'Sociologia';
UPDATE "oab_questions" SET "discipline" = 'PHILOSOPHY'             WHERE "discipline" = 'Filosofia';
UPDATE "oab_questions" SET "discipline" = 'TRAFFIC_LEGISLATION'    WHERE "discipline" = 'Legislação de Trânsito';
UPDATE "oab_questions" SET "discipline" = 'ECONOMIC_LAW'           WHERE "discipline" = 'Direito Econômico';
UPDATE "oab_questions" SET "discipline" = 'NOTARY_REGISTRY_LAW'    WHERE "discipline" = 'Direito Notarial e Registral';
UPDATE "oab_questions" SET "discipline" = 'EXTERNAL_CONTROL'       WHERE "discipline" = 'Controle Externo';
UPDATE "oab_questions" SET "discipline" = 'URBAN_LAW'              WHERE "discipline" = 'Direito Urbanístico';
UPDATE "oab_questions" SET "discipline" = 'ELDERLY_PERSON_STATUTE' WHERE "discipline" = 'Estatuto da Pessoa Idosa';
