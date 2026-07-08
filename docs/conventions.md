# LexFlow conventions & refactor playbook

Read this before changing code. It is the contract for subagents doing the LexFlow
refactor. `CLAUDE.md` holds the project overview/infra; this file holds the **rules**
and a **step-by-step playbook** for the in-progress cleanup. The foundation referenced
here already exists and is tested — adopt it; don't reinvent it.

## Non-negotiable rules

1. **English code, pt-BR label — never hardcode pt-BR option strings.** Picklist values
   (disciplines, difficulties, exam boards, phases) live in the `list_of_values` table:
   `type` (UPPER_SNAKE) + `code` (English, stored in domain tables + used in logic) +
   `value` (pt-BR label shown to users). The UI gets options/labels from `useLov(type)`
   (`app/src/shared/hooks/use-lov.ts`); the seed lives in `shared/data/lov.ts`. Adding or
   relabeling a value = add/edit a row there + `pnpm db:seed-lov` (the LOV-only, FK-free
   delete+insert — **NOT** `pnpm db:seed`, which reseeds the whole `oab_questions` catalog).
   NEVER put a pt-BR literal like `'Fácil'` or `'Direito Civil'` in a component or router.

2. **No duplicated code.** If two files need the same thing, it goes in a shared module:
   - Cross-cutting types/business rules → `shared/` (importable by `api/` and `app/`).
   - Frontend-only shared UI/hooks → `app/src/shared/`.
     The four simulation components currently each redefine `interface Question {…}` +
     a row→Question mapper — replace those with `Question` + `toQuestion()` from
     `shared/domain/question.ts`.

3. **No business rules in the API or in components — put them in `shared/` lib functions.**
   Routers and components call shared pure functions; they don't re-implement formulas.
   Canonical homes (already built + unit-tested):
   - `shared/domain/scoring.ts` — `accuracyPct`, `goalProgressPct`
   - `shared/domain/adaptive.ts` — `nextDifficulty`, `DEFAULT_ADAPTIVE_CONFIG`
   - `shared/domain/spaced-repetition.ts` — `nextReviewIntervalDays`, `DEFAULT_REVIEW_INTERVALS_DAYS`

4. **Algorithms are config-driven (flexible).** Thresholds/intervals/levels are parameters
   with defaults (see the `*Config` objects above), not magic numbers scattered in code.
   New tunables go on the config object, not as inline constants.

5. **Don't break the baseline.** Every change must keep `pnpm validate` (tsc + eslint
   `--max-warnings 0` + vitest) and `pnpm build` green. Work additively; migrate one
   concern at a time. The app is live (CloudFront + API Gateway) — see `CLAUDE.md`.

6. **Inherited rules still apply** (`CLAUDE.md`): per-user `createScopedDb`, `@clerk/*`
   only in the auth adapter, snake_case DB columns / camelCase TS, no `console.log`/`any`/
   `!`, migrations via `db:generate` → review → `db:migrate` (never manual SQL), deploy via
   GitHub Actions only.

## What already exists (the foundation — use it)

| Concern                     | Module                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| Picklist table              | `drizzle/schema.ts` → `list_of_values` (+ `TABLE_SCOPE` in `api/db/scope.ts`) |
| Picklist seed (codes→pt-BR) | `shared/data/lov.ts` (`LOV_SEED`)                                             |
| Picklist API                | `api/trpc/routers/list-of-values.router.ts` (`trpc.lov.list`, public)         |
| Picklist hook               | `app/src/shared/hooks/use-lov.ts` (`useLov`)                                  |
| Scoring rules               | `shared/domain/scoring.ts`                                                    |
| Adaptive algo               | `shared/domain/adaptive.ts`                                                   |
| Spaced-rep algo             | `shared/domain/spaced-repetition.ts`                                          |
| Canonical Question          | `shared/domain/question.ts` (`Question`, `toQuestion`)                        |
| Unit tests (pattern)        | `shared/domain/*.test.ts`                                                     |

## Refactor playbook (do these as separate, validated commits)

Each item is a self-contained task. Run `pnpm validate` after each; keep the app working.

### A. Adopt the shared question type/mapper

In `app/src/pages/TestingPage.tsx` and `app/src/components/{AdaptiveSimulation,SpacedRepetition,RealExamSimulation}.tsx`:
delete the local `interface Question` + inline `rows.map(...)` and import `Question` +
`toQuestion` from `@shared/domain/question` (frontend alias) — or relative. Switch field
access from snake_case (`question_text`) to camelCase (`questionText`). Tip: these pages are
currently ESLint-quarantined; as you touch one, un-quarantine it (remove from the ignore list
in `eslint.config.js`) and harden it to pass strict lint.

### B. Adopt the shared business rules

Replace inline formulas with the shared functions:

- `api/trpc/routers/stats.router.ts` + `goals.router.ts`: use `accuracyPct` / `goalProgressPct`
  where they compute percentages in TS (keep SQL aggregates, but any TS-side math uses the lib).
- `AdaptiveSimulation.tsx`: replace its local `getNextDifficulty` with `nextDifficulty`.
- `SpacedRepetition.tsx`: replace its local `getNextInterval`/`INTERVALS` with
  `nextReviewIntervalDays` / `DEFAULT_REVIEW_INTERVALS_DAYS`.
- `app/src/pages/GoalsPage.tsx`: progress via `goalProgressPct`.

### C. Migrate picklists + stored values to LOV codes

1. **Seed** is already in place (`LOV_SEED`). Confirm `trpc.lov.list` returns rows.
2. **Dropdowns:** replace `DISCIPLINES`/`EXAM_BOARDS`/`DIFFICULTIES` from `app/src/types.ts`
   in every `<select>` with `useLov("DISCIPLINE"|"EXAM_BOARD"|"DIFFICULTY")`. Store
   `option.code`; render `labelOf(code)`. Remove the hardcoded `'Facil'/'Medio'/'Dificil'`
   ternaries.
3. **Stored values:** migrate `oab_questions.{discipline,difficulty,examBoard,phase}` to store
   **codes** (e.g. `CONSTITUTIONAL_LAW`, `EASY`, `FIRST`). Do it via a Drizzle migration +
   update `shared/data/oab-questions.ts` to emit codes + re-seed. Update the `questions`/`stats`
   routers' filters to compare codes. The frontend then renders labels via `useLov`.
4. Once nothing imports the pt-BR arrays, delete them from `app/src/types.ts`.

### D. Extract remaining duplicated UI (optional, after A–C)

The answer-options block + the per-question timer repeat across the simulation components.
Extract `app/src/shared/components/QuestionCard.tsx` (renders a `Question` + options +
selection) and `app/src/shared/hooks/use-exam-timer.ts`, then adopt them. Author to strict lint.

## Verify (after every change)

```bash
pnpm validate          # tsc + eslint --max-warnings 0 + vitest  (MUST pass)
pnpm build             # vite build  (MUST pass)
pnpm db:seed-lov       # if you changed LOV_SEED (picklists only, FK-free, idempotent)
pnpm db:seed           # only if you changed the oab_questions catalog seed (heavy; idempotent)
pnpm smoke             # exercises the data API against the real DB, self-cleans
```

Deploy is automatic on push to `main` (paths-filtered). Keep `main` green.
