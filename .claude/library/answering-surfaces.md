# Answering surfaces — where a student answers a question

Map of every place a question is presented and answered, so no agent has to re-explore this.
Captured 2026-08-20 (epic #65). Update it when a surface is added or moved.

## Desktop app (`app/`, deployed by `deploy-app.yml` → https://my.probius.app)

Shared multiple-choice UI: **`app/src/shared/components/QuestionCard.tsx`** — renders the
discipline/board line, question text, option buttons, optional bookmark toggle + notes textarea.
The caller owns the card wrapper, header/timer and the action buttons. Props today:
`options`, `selectedAnswer`, `onSelect`, `locked`, `correctAnswer`, `note`/`onNoteChange`,
`isBookmarked`/`onToggleBookmark`.

Callers (the four MC test screens):

| Screen              | File                                        | Notes                                                          |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Simulado Padrão     | `app/src/pages/TestingPage.tsx`             | two-step Conferir→Próxima; HAS "Responder depois"; quarantined |
| Simulado Real       | `app/src/components/RealExamSimulation.tsx` | quarantined (max-lines-per-function)                           |
| Repetição Espaçada  | `app/src/components/SpacedRepetition.tsx`   | quarantined                                                    |
| Simulado Adaptativo | `app/src/components/adaptive-screens.tsx`   | driven by `AdaptiveSimulation.tsx` (quarantined)               |

Supporting pure modules (unit-tested with plain vitest, no RTL):

- `app/src/shared/lib/exam-queue.ts` — `moveToEnd` (postpone in standard mode),
  `findNextUnanswered` (postpone in real-exam mode). Never records a blank answer.
- `app/src/pages/testing-flow-guards.ts` — `primaryLabel`, `primaryDisabled`, `canPostponeGuard`.
- `app/src/shared/hooks/use-notes-bookmarks.ts` — notes (debounced upsert) + bookmark toggle.
- `app/src/shared/lib/shuffle.ts`, `shared/domain/scoring.ts` (`accuracyPct`).

Other option-rendering screens (read-only, NOT answering): `app/src/pages/SavedQuestionsPage.tsx`,
admin forms (`admin-question-form.tsx`). Discursive 2ª fase has its own non-MC UI:
`app/src/components/discursive/DiscursiveQuestionCard.tsx` + `DiscursiveRunner.tsx`.

## Mobile app (`apps/mobile/`, deployed by `deploy-mobile.yml`)

Single immersive runner: **`apps/mobile/src/components/QuestionRunner.tsx`** — used by
`PracticePage.tsx` (Praticar), `DrillPage.tsx` (Drill) and `ReviewPage.tsx` (Revisão) via
`RunnerQuestion`. Select → instant reveal (single step, no Conferir) → Próxima; records the whole
session on finish. Has the bookmark button; **no postpone today** (must answer to advance).
State container: `apps/mobile/src/state/practice-context.ts`. Result: `ResultPage.tsx`.
`FlashcardsPage.tsx` and `SavedPage.tsx` render options with their own local UI.

## Backend touched by answering

- `sessions.record` — one transaction: session + every answer; moves the SM-2 schedule.
- `questions.list` / `questions.reviewQueue` / `questions.dueCount`; `stats.*` computed on read.
- `bookmarks.toggle` / `bookmarks.list` (`user_bookmarks`), `notes.upsert` / `notes.list`
  (`user_question_notes`), SM-2 state in `user_question_states` (`drizzle/schema.ts`).

## Life of a test run (as of 2026-08-20 — before BR-05 lands)

1. **Start** — the student picks a mode on the mode-selection screen; `TestingPage.tsx` holds
   `mode` in React state, the runner component fetches its questions and owns the queue, the
   answers-so-far, the timer and the cursor. Nothing about the run exists outside browser memory.
2. **Answer / postpone** — all in that component state (BR-03; blanks never recorded).
3. **Leave** — any unmount (mode switch via `setMode(null)`, route change, tab close, reload)
   discards the whole run silently. There is no `localStorage`/`sessionStorage` use anywhere in the
   repo and no partial-run table, so a run that is not finished leaves no trace. **This is the gap
   BR-05 closes.**
4. **Finish** — the runner calls `sessions.record` ONCE with the full answer list. That single
   transaction inserts `study_sessions` (`totalQuestions`, `correctAnswers`, `endedAt = now()`),
   inserts one `user_answers` row per answer, and moves the SM-2 schedule
   (`upsertSm2States`). Input requires **at least one answer** (`answers.min(1)`).
5. **Read back** — `sessions.listRecent`; all statistics are computed on read from `user_answers`,
   so anything not recorded in step 4 simply never happened.

`sessions.record` is therefore the single processing path: "finish", "quit and process" and a
real-exam auto-submit are all the same operation over a shorter answer list.

## Functional definitions attached to these surfaces

- [BR-02 Descartar alternativas](kb-business/br-02-cross-out.md)
- [BR-03 Responder depois = postpone, not bookmark](kb-business/br-03-postpone.md)
- [BR-04 Bookmarks](kb-business/br-04-bookmarks.md)
- [BR-05 Salvar progresso / Sair e processar](kb-business/br-05-save-quit-test.md)
