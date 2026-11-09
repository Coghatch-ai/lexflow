# Estudar por tema — topic filter in the study setups (issue #102)

**Goal** — a student can start a Simulado Padrão or a Simulado Adaptativo restricted to ONE
topic of a discipline (e.g. "Controle de Constitucionalidade" inside Direito Constitucional)
instead of the whole discipline.

## What the repo already holds (read, not assumed)

- `oab_questions.topic` **already exists** (`drizzle/schema.ts:73`) — `text().notNull()`, a raw
  pt-BR label (`"Controle de Constitucionalidade"`, `"Parte Geral"`). It is **outside BR-01**:
  BR-01 covers `{discipline, exam_board, difficulty, phase}` only, so `topic` is deliberately a
  label, not an LOV code. No taxonomy has to be invented or seeded.
- `topic` is **used nowhere today**: no filter in `questions.list` (`api/trpc/routers/questions.router.ts:38-60`),
  no index on the column, no UI. It is written by the importers only
  (`scripts/seed-from-csv.ts`, `api/trpc/routers/admin.router.ts`).
- Content is chosen in two setup screens, both already discipline-aware:
  `app/src/pages/testing-standard-setup.tsx` (Disciplina / Banca / Dificuldade → 10 random
  questions) and `app/src/components/adaptive-screens.tsx` `AdaptiveSetup` (Disciplina +
  "Número de questões" slider 5–30).
- A run's filters are persisted in `exam_drafts.setup` — **`jsonb`** (`drizzle/schema.ts:205`),
  typed by `ExamDraftSetup` (`shared/domain/exam-draft.ts:106-108`) and validated by the
  `setup` discriminated union in `api/trpc/routers/exam-drafts.router.ts:45-58`. Adding a field
  is a type + zod change, **no migration**.
- Catalog measured on `ba/questions.csv` (1938 rows, the seed source): **681** distinct topic
  strings, **700** `(discipline, topic)` pairs — **341 pairs hold exactly one question**, 109
  hold ≥5, 25 hold ≥10. **199 rows (10%) carry the scraper placeholder `( assuntos)`** as their
  topic. Direito Constitucional: 189 questions, 62 topics, 28 of them single-question.

## Scope (in)

- **S1 — backend + Simulado Padrão.** A `questions.topics` query (`protectedProcedure`, like the
  existing `questions.disciplines`) returning, for one `discipline`, the distinct topics of the
  catalog **each with its question count**, ordered by topic label, excluding the `( assuntos)`
  placeholder and blank topics. A `topic` field on the `questions.list` input, applied as an
  equality filter. A "Tema" `<select>` in `testing-standard-setup.tsx` below Disciplina:
  optional, default `Todos os temas`, disabled while Disciplina is `Todas`, each option labelled
  `<tema> (<n>)`. The chosen topic travels into the draw and into `StandardSetup` /
  `ExamDraftSetup` so a resumed run keeps it.
- **S2 — Simulado Adaptativo.** The same "Tema" select in `AdaptiveSetup`, feeding the
  `drawPool` call and the `adaptive` branch of `ExamDraftSetup`.

## Scope (out)

- **Cleaning the topic data** — the `( assuntos)` rows, the single-question long tail,
  user-friendly topic names. The user's call: a separate issue, with a specialist consulted.
- **Revisão Espaçada and Simulado Prova Real** — no content filters by design (the prova real is
  the real exam's 80 questions); untouched.
- **Topping up a thin topic from the rest of the discipline, or blocking a thin topic** — the
  filter returns what exists; the thinness is a data defect, not a UI mechanism.
- **A new "Estudar por tema" mode/screen** — the user chose the two existing setups.
- **A TOPIC LOV / seeded taxonomy** — 681 values that the importer keeps growing; the list is
  derived from the catalog instead. `topic` stays outside BR-01.
- **A migration / an index on `oab_questions.topic`** — nothing under `drizzle/` changes this
  slice (the column and the `jsonb` setup already exist; 1938 rows need no index).
- **Topic in statistics, analytics, study plans, flashcards or the result screen** — parked.

## Business rules / product facts (the user's own words, verbatim)

> "okay, so may we have a issue to fix the data? I think from the UI, we can dedcide, then, we
> can fix the data later and make more user friendsly, I can ask the specilaist. so, we use
> "topic""

> "what I just said ? THE DATA IS WRONG. WE NEED TO DECIDE THE FILTER."

> "you sjhould not require a answer, becaus elike now, you may not have anythiuntg."
> (on the Tema select — it is optional, like Disciplina)

Confirmed shape, in the user's accepted wording:

1. A "Tema" select is added to the Simulado Padrão setup AND the Simulado Adaptativo setup,
   below Disciplina. Optional, default "Todos os temas", enabled once a discipline is chosen.
2. The list comes from the catalog itself for that discipline, each entry with its question
   count — "Controle de Constitucionalidade (7)"; the "( assuntos)" placeholder is hidden.
3. `questions.list` accepts a topic filter; the chosen topic is saved with the run so a resumed
   run keeps it.
4. If the topic has fewer questions than the run length, the run simply uses what exists (no
   top-up from other topics, no blocking) — because the data, not the UI, is what needs fixing.
5. Separate issue, not this slice: clean up the topic data and make the names user-friendly.

## Acceptance

**S1 — backend + Simulado Padrão**

1. `questions.topics({ discipline: "CONSTITUTIONAL_LAW" })` returns an array of
   `{ topic: string; count: number }`, ordered by `topic`, where every `count` ≥ 1, no element
   has `topic === "( assuntos)"` and no element has a blank/whitespace `topic`.
2. `questions.list({ discipline: "CONSTITUTIONAL_LAW", topic: T, limit: 10 })` returns rows whose
   `topic === T` for **every** row, and at most `min(10, count(T))` rows.
3. `questions.list` called **without** `topic` returns the same result set as before the change
   (no row count or filter change) — unit/integration assertion on the existing behaviour.
4. On the Simulado Padrão setup: with Disciplina = `Todas`, the Tema select is disabled and shows
   `Todos os temas`. After choosing a discipline, its options are exactly the
   `questions.topics` result rendered as `<tema> (<n>)`, with `Todos os temas` first.
5. Starting a run with a Tema chosen: every question on the board belongs to that topic, and the
   number of questions drawn equals `min(10, count(topic))`.
6. After `examDrafts.save` of that run, the persisted `setup` JSON contains the chosen `topic`;
   `examDrafts.get` → resume replays the SAME question ids (BR-05 frozen queue unchanged) and the
   setup read back still carries the topic.
7. `pnpm validate` (api + app + shared) passes; no file under `drizzle/` is modified.

**S2 — Simulado Adaptativo**

8. `AdaptiveSetup` shows the same Tema select below Disciplina, with the same disabled/`Todos os
temas` behaviour, and the slider keeps its 5–30 range unchanged.
9. Starting an adaptive run with a Tema chosen: the drawn candidate pool contains only questions
   of that topic, and the persisted `setup` JSON (adaptive branch) carries the `topic`.
10. Resuming that adaptive run re-draws the pool from the persisted setup, i.e. still restricted
    to the same topic.
11. A topic thinner than the slider value starts the run anyway with the questions that exist —
    no error dialog, no questions from another topic. `[human check]` that the screen is not
    visually broken in that case.
12. `pnpm validate` passes; `eslint` budgets respected (the authored `.tsx` caps:
    `max-lines-per-function` 250, `complexity` 25) — split per `docs/conventions.md` rather than
    exempting.

## Skill notes

- `docs/conventions.md` LOV rules + **BR-01**: `topic` is NOT an LOV code and must not be turned
  into one; `discipline` stays the English LOV code on both sides of the new filter.
- Display text pt-BR (`Tema`, `Todos os temas`), code English, per `CLAUDE.md`.
- BR-05 / `answering-surfaces.md`: a resume NEVER re-queries `questions.list` for the standard
  mode (it orders by `random()`); the adaptive mode re-draws its POOL from the persisted setup —
  the new field must feed that re-draw or a resumed adaptive run silently widens back to the
  whole discipline.
- `shared/` holds the rule: the placeholder-exclusion constant and the topic input type belong in
  `shared/`, not duplicated in api + app.
- Both tiers stay `protectedProcedure` (the catalog reads already are).

## Applied recommendations

| Decision                       | What you applied                                                                        | Why                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Topic source                   | Derive the list from `oab_questions` at query time; no TOPIC LOV, no seed               | 681 values today and the importer keeps adding; a seeded LOV would rot. `topic` is outside BR-01 already. |
| Schema                         | No migration, no index; reuse `oab_questions.topic` and the `jsonb` `exam_drafts.setup` | Both already exist; CI does not migrate, so avoiding `drizzle/` keeps the slice deploy-only.              |
| Thin-topic behaviour           | Run with what exists; no top-up, no block                                               | User: "THE DATA IS WRONG. WE NEED TO DECIDE THE FILTER." The UI honours the filter; data is fixed apart.  |
| Single topic, not multi-select | One topic per run                                                                       | Matches the request ("a specific topic") and the existing one-value-per-filter setup screens.             |
| Counts in the option label     | `<tema> (<n>)`                                                                          | The only honest warning about a thin topic, and it costs nothing once the query groups by topic.          |
| Slice split                    | S1 backend + Padrão, S2 Adaptativo                                                      | Keeps each slice one builder / one verify; S2 reuses S1's query and select.                               |
| PRD language                   | English prose, pt-BR only for UI strings                                                | Matches every existing `design/*.md` and `CLAUDE.md`'s "Agent-to-developer communication is English".     |

## Later

- Clean up the topic data: drop/replace the `( assuntos)` placeholder, merge duplicates, make the
  labels user-friendly (user will consult a specialist) — **its own issue**.
- Multi-topic selection, and "topics I got wrong" as a drill source.
- Topic breakdown on the result screen and in `stats` / `AnalyticsPage`.
- Topic in study plans, flashcards and the coach's focused drill.
- Topic filter on Revisão Espaçada, and on the 2ª-fase (`oab_discursive_questions.topic`, nullable).

## Open questions

None blocking implementation.
