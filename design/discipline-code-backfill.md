# Discipline code/label backfill (issue #46)

**Goal** — Every `oab_questions.discipline` value stores an English LOV code (not a raw
pt-BR scraper label), so the `/testing` filter returns questions and stats/admin show clean
pt-BR labels — for all 1938 catalog rows and every future CSV import.

## Verified facts (live prod RDS, read-only `pnpm db:query`)

- `list_of_values` is populated: DISCIPLINE=20, DIFFICULTY=3, EXAM_BOARD=2, PHASE=2,
  QUESTION_TYPE=2, PLAN_DEADLINE=6. **LOV is NOT the problem** (an earlier analysis guessed
  "LOV empty in prod" — verified wrong).
- **Only `discipline` is broken.** All 1938 rows store a pt-BR label; **0** store a LOV code.
- **`exam_board`, `difficulty`, `phase` are fine (verified, not assumed):**
  - `exam_board`: 1938/1938 = `"FGV"` → is a valid EXAM_BOARD code (code == value). OK.
  - `difficulty`: 1938/1938 = `"medium"` → valid DIFFICULTY code. OK.
  - `phase`: 1938/1938 = `"1st"` → valid PHASE code. OK.
- 32 distinct `discipline` labels. Breakdown (VERIFIED counts):
  - **13 labels** are an exact LOV `value` → trivial value→code (1152 rows).
  - **6 labels** are verbose variants of an existing discipline → map to existing code
    (744 rows): `"Estatuto da Advocacia e da OAB…"`→`LEGAL_ETHICS`,
    `"Direito Processual Civil - Novo CPC 2015"`→`CIVIL_PROCEDURE`,
    `"Direito Processual Penal"`→`CRIMINAL_PROCEDURE`,
    `"Direito Processual do Trabalho"`→`LABOR_PROCEDURE`,
    `"Direito Empresarial (Comercial)"`→`COMMERCIAL_LAW`,
    `"Direito da Criança e do Adolescente - ECA…"`→`CHILD_ADOLESCENT_LAW`.
  - **2 labels** = Internacional Público (18) + Privado (16) → **both** `INTERNATIONAL_LAW`
    (user decision: merge).
  - **11 labels** have no LOV entry (58 rows) → **new LOV codes** (user decision: add each).

> The earlier analysis's "~820 unmapped" figure is UNVERIFIED/wrong. Truly-no-target rows =
> **58** (the 11 new disciplines); everything else maps to an existing code.

## Root cause (verified in code)

`scripts/seed-from-csv.ts:74` writes `discipline: r.discipline` — the raw pt-BR scraper
label, with no label→code mapping. Contrast the generator path
`shared/data/oab-questions.ts:777` which does `DISCIPLINE_CODE_BY_VALUE[discipline] ?? discipline`.
The CSV path (which seeded prod) skipped that map. Same file also hardcodes
`difficulty:"medium"` (:73) and passes `examBoard:r.banca`/`phase` raw — those happen to
land on valid codes today, but are not defensively mapped.

## Functionality map (which break, which are fine)

| Feature                                             | Path                                                             | Status                              | Fixed by                 |
| --------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- | ------------------------ |
| `/testing` discipline filter                        | `questions.router.ts:32` `eq(discipline, code)`                  | **BROKEN** (0 rows)                 | backfill                 |
| Admin questions list/filter (#44)                   | `admin.router.ts:245` `eq(discipline, code)`                     | **BROKEN** (0 rows)                 | backfill                 |
| Stats by discipline                                 | `stats.router.ts:40-51` group by `discipline`, UI `labelOf`      | **DEGRADED** (verbose labels shown) | backfill                 |
| Recurring errors                                    | `stats.router.ts:81-97` group by `discipline`                    | **DEGRADED** (verbose labels)       | backfill                 |
| `questions.list` examBoard/difficulty/phase filters | `questions.router.ts:33-35`                                      | FINE                                | —                        |
| Stats byExamBoard / byResponseTime                  | `stats.router.ts:54-78`                                          | FINE                                | —                        |
| reviewQueue                                         | `questions.router.ts:54` (no discipline filter)                  | FINE                                | —                        |
| `questions.disciplines` procedure                   | `questions.router.ts:45` `selectDistinct`                        | ORPHAN (no UI consumer)             | out of scope             |
| `'Geral'` fallback                                  | `TestingPage.tsx:461` writes `study_sessions.discipline='Geral'` | magic string, no stats read it      | out of scope (see Later) |

## Scope (in)

1. **Backfill migration** — `pnpm db:generate` produces `UPDATE oab_questions SET discipline
= <code> WHERE discipline = <label>` for each of the 32 labels (32→19 target codes: 13
   existing + 6 verbose→existing + intl 2→1 + 11 new). Review the generated SQL, then
   `pnpm db:migrate`. **Never manual SQL on RDS.** The label→code map is the single source
   (see Business rules).
2. **LOV additions** — add the 11 new DISCIPLINE rows (below) to `shared/data/lov.ts`
   `LOV_SEED`, then `pnpm db:seed-lov` (FK-free, idempotent, delete+insert). Assign
   `sortOrder` to keep pt-BR alphabetical by `value`.
3. **Seed fix** — `scripts/seed-from-csv.ts:74`: map `r.discipline`→code before insert and
   **throw** on any unmapped label (mirror `resolveCorrectAnswer`'s loud-fail at :50-60).
   Also defensively map `examBoard`/`phase` and derive/validate `difficulty` against LOV
   codes. Reuse the value→code map — extract a shared helper so `seed-from-csv.ts`,
   `oab-questions.ts`, and the migration all share one map + one alias table (the verbose
   variants).
4. **CLAUDE.md business rule** — add the durable rule (user-approved) to a
   `## Business rules / product facts` block.

### 11 new DISCIPLINE LOV rows (user-approved as-is)

| code                      | value (pt-BR)                      | rows |
| ------------------------- | ---------------------------------- | ---- |
| `FEDERAL_LEGISLATION`     | Legislação Federal                 | 19   |
| `DIGITAL_LAW`             | Direito Digital                    | 4    |
| `DISABLED_PERSON_STATUTE` | Estatuto da Pessoa com Deficiência | 4    |
| `SOCIOLOGY`               | Sociologia                         | 2    |
| `PHILOSOPHY`              | Filosofia                          | 2    |
| `TRAFFIC_LEGISLATION`     | Legislação de Trânsito             | 2    |
| `ECONOMIC_LAW`            | Direito Econômico                  | 1    |
| `NOTARY_REGISTRY_LAW`     | Direito Notarial e Registral       | 1    |
| `EXTERNAL_CONTROL`        | Controle Externo                   | 1    |
| `URBAN_LAW`               | Direito Urbanístico                | 1    |
| `ELDERLY_PERSON_STATUTE`  | Estatuto da Pessoa Idosa           | 1    |

### Full label→code backfill map (all 32 stored labels)

Exact value matches (→ same-name code): Direito Constitucional→`CONSTITUTIONAL_LAW`,
Direito Civil→`CIVIL_LAW`, Direito Penal→`CRIMINAL_LAW`, Direito do Trabalho→`LABOR_LAW`,
Direito Tributário→`TAX_LAW`, Direito Administrativo→`ADMINISTRATIVE_LAW`, Direitos
Humanos→`HUMAN_RIGHTS`, Direito do Consumidor→`CONSUMER_LAW`, Direito
Ambiental→`ENVIRONMENTAL_LAW`, Filosofia do Direito→`LEGAL_PHILOSOPHY`, Direito
Eleitoral→`ELECTORAL_LAW`, Direito Previdenciário→`SOCIAL_SECURITY_LAW`, Direito
Financeiro→`FINANCIAL_LAW`.

Verbose variants → existing code: as listed in Verified facts (6).

Intl → merged: Direito Internacional Público **and** Direito Internacional Privado →
`INTERNATIONAL_LAW`.

11 new → codes in the table above.

## Scope (out)

- Drop the 3 dead aggregate tables / `study_sessions.discipline` denorm — separate cleanup,
  not this bug.
- Remove/repurpose the orphan `questions.disciplines` procedure — no consumer, not blocking.
- Fix the `'Geral'` magic string at `TestingPage.tsx:461` — unrelated to this filter bug; parked.
- Backfilling `difficulty` to real per-question values — all rows are `"medium"`; that's a
  data-quality question, not a code/label bug.

## Business rules / product facts (user's own words → durable)

Approved for the project `CLAUDE.md`:

> `oab_questions.{discipline,exam_board,difficulty,phase}` MUST store the English LOV code,
> never the pt-BR label. Any importer (`scripts/seed-from-csv.ts`, `scripts/seed.ts`) MUST
> map label→code before insert and throw on an unmapped label — never write a raw scraper
> label.

Product decisions captured this session:

- Internacional Público + Privado → **merge** into the single existing `INTERNATIONAL_LAW`.
- The 11 unmatched disciplines → **each becomes a new LOV discipline** (codes/labels above),
  keeping all 58 questions filterable.
- Fix method → **one-time backfill migration** (`db:generate`→review→`db:migrate`), not a
  re-seed/re-scrape.

## Acceptance

- **State delta:** `SELECT count(*) FROM oab_questions WHERE discipline NOT IN (SELECT code
FROM list_of_values WHERE type='DISCIPLINE')` returns **0** (was 1938).
- **State delta:** `SELECT count(*) FROM oab_questions WHERE discipline='COMMERCIAL_LAW'`
  returns **99** (was 0).
- **Response:** `questions.list({ discipline:'COMMERCIAL_LAW' })` returns a non-empty set
  (was 0 rows).
- **State:** `list_of_values` DISCIPLINE count = **31** (20 + 11) after `db:seed-lov`.
- **Guard:** `seed-from-csv.ts` throws on a discipline label absent from the map (unit test:
  feed an unknown label → expect throw; feed a known label → expect the mapped code).
- **Invariant (unit, no DB):** every discipline emitted by the shared map helper ∈ LOV
  DISCIPLINE codes.
- **Regression (smoke):** extend `pnpm smoke` to assert the NOT-IN-codes count = 0.
- **[human check]** `/testing`: pick "Direito Empresarial" → questions load; Analytics shows
  clean pt-BR discipline labels, not verbose strings or English codes.

## Skill notes

- `docs/conventions.md` rule 1: English code / pt-BR label, LOV via `shared/data/lov.ts` +
  `pnpm db:seed-lov` (NOT `db:seed`). Rule 6 + `CLAUDE.md`: migrations via
  `db:generate`→review→`db:migrate`, never manual SQL; keep `pnpm validate` + `pnpm build`
  green; no `console.log`/`any`/`!`.
- `oab_questions` is global (no `TABLE_SCOPE` change; backfill is a catalog write, no
  per-user scope).
- Deploy is GitHub Actions only. This fix is **migration-gated** (needs `db:migrate` +
  `db:seed-lov` run against prod RDS) and **deploy-gated** for the `seed-from-csv.ts` +
  `lov.ts` code → label the issue `fixed-pending-deploy`.

## Applied recommendations

| Decision                   | What I applied                                 | Why                                                                 |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| 13 exact-value labels      | value→same-name code                           | Unambiguous LOV value match                                         |
| 6 verbose variants         | → existing code (COMMERCIAL_LAW etc.)          | Clearly the same discipline, verbose scraper text                   |
| Backfill vs re-seed        | migration (db:generate→migrate)                | CLAUDE.md forbids manual SQL / re-scrape not set up; user confirmed |
| Seed fix                   | map + throw on unmapped                        | Mirrors existing `resolveCorrectAnswer` loud-fail; stops recurrence |
| Shared map helper          | extract one value→code + alias map             | conventions rule 2 (no duplication)                                 |
| examBoard/difficulty/phase | left as-is, add defensive mapping in seed only | verified already valid codes; no backfill needed                    |

## Later

- Fix `'Geral'` magic string (`TestingPage.tsx:461`) — write `null`/omit, or stop storing
  discipline on the session.
- Drop dead aggregate tables + `study_sessions.discipline`/`.difficulty` denorm.
- Remove orphan `questions.disciplines` procedure.
- UI guard-rail: warn when a stored discipline isn't a known LOV code (surfaces silent drift).
- Real per-question `difficulty` (all rows currently `"medium"`).

## Open questions

None — blocking decisions resolved.
