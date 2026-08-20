# S1 — "Sair e processar": end a test early and keep the answers

Epic [#67](https://github.com/Coghatch-ai/lexflow/issues/67) · rule
[BR-05](../.claude/library/kb-business/br-05-save-quit-test.md) · surfaces
[answering-surfaces.md](../.claude/library/answering-surfaces.md)

**Goal** — a student who leaves a test in progress is asked what to do, and can end it now with the
answers already given recorded, instead of losing them silently.

## Scope (in)

- A leave attempt from any of the 4 answering screens (Simulado Padrão, Repetição Espaçada,
  Simulado Adaptativo, Simulado Real) opens a pt-BR confirmation dialog instead of unmounting.
  - Study modes (Padrão, Repetição Espaçada, Adaptativo): **Continuar** · **Sair e processar
    respostas** · (**Salvar e sair** arrives in a later slice — do NOT render it yet).
  - Simulado Real: **Continuar prova** · **Encerrar e processar respostas**, with the warning that
    a prova real cannot be saved (BR-05.5).
- "Leave attempt" = the in-app exits that today call `setMode(null)` / navigate away from a running
  test (`app/src/pages/TestingPage.tsx:501,521,535` and the equivalent back/switch handlers in
  `RealExamSimulation.tsx`, `SpacedRepetition.tsx`, `AdaptiveSimulation.tsx`).
- Choosing to process: submit the answers given so far through the existing single processing path
  (`sessions.record`), then show the same result screen the mode shows on a normal finish.
- Browser-level exit (tab close / reload) while a test is in progress arms the browser's native
  "leave site?" prompt. No custom UI, no persistence in this slice.
- One shared, testable decision module for the exit rules (pure, plain-vitest, no RTL), following
  the pattern of `app/src/pages/testing-flow-guards.ts`: given mode + answered count, return which
  dialog options are offered and whether processing is possible.

## Scope (out)

- **Salvar e sair, autosave, resume, "Continuar (n/N)" on the mode card** — needs server-side
  storage; separate slices (S2–S5), and the storage shape is still an open decision on #67.
- **Simulado Real auto-submit on abrupt exit / timeout** — same reason: it needs the internal save.
  In this slice an abruptly closed prova real is still lost.
- **Mobile runner** — its own slice (S6).
- **Discursive (2ª fase)** — scoped out of the epic.
- Any schema change, any migration. This slice touches frontend only.

## Business rules / product facts

Authoritative: [BR-05](../.claude/library/kb-business/br-05-save-quit-test.md). User's own words:

> "we have 4 screens to test. if the user change the tab. looses the progression. we need to have a
> option to save for 3. "real test" should give a message, because the goal is to simulate real
> world. but the user may. "quit" so, it will process the answers. the goal is to give the user the
> hability to save the progress OR quit where is. quit should have a option for all, save, only for 3"

Binding for this slice:

1. Quit exists on all 4 modes; save exists on none of them yet (it is a later slice, not a
   permanent absence).
2. Processing counts only what was answered. Unanswered questions are not errors, are not recorded,
   do not touch the SM-2 schedule, and may reappear in a future test (BR-05.6, consistent with
   BR-03: a blank answer is never recorded).
3. A processed partial run is a normal session: it counts in statistics and in the spaced-repetition
   schedule exactly like a finished one (BR-05.7).
4. Simulado Real must state that the exam cannot be saved before the student confirms leaving
   (BR-05.5).
5. UI text is pt-BR; code/identifiers English.

## Acceptance

1. In each of the 4 modes, with ≥1 question answered, triggering the mode's in-app exit renders the
   confirmation dialog and the run is still on screen behind it — the runner does NOT unmount.
2. Choosing **Continuar** closes the dialog and leaves cursor, answers and timer unchanged.
3. Choosing **Sair e processar respostas** after answering 12 of 30 (8 correct) results in exactly
   one `sessions.record` call carrying 12 answers; the response is
   `{ totalQuestions: 12, correctAnswers: 8 }`, and 12 rows — not 30 — land in `user_answers`.
   Verify end-to-end with `pnpm smoke` against a throwaway user.
4. After that call, `stats.summary` for the user counts those 12 answers, and the 18 unanswered
   question ids appear in neither `user_answers` nor `user_question_states`.
5. Quitting with **0 answers** performs no `sessions.record` call at all (the input requires
   `answers.min(1)`), shows no error, and simply exits the mode.
6. The Simulado Real dialog offers exactly two actions — continue and end-and-process — and shows
   the pt-BR "não pode ser salva" warning. It offers no save action.
7. The study-mode dialog offers exactly two actions in this slice (continue, end-and-process) — no
   dead/disabled "Salvar e sair" button ships.
8. New pure module has unit tests (plain vitest, no new deps) covering: options offered per mode,
   and processing suppressed at 0 answers.
9. `pnpm validate` passes. Files already lint-quarantined stay no worse; any new file is fully
   strict-lint clean.
10. `[human check]` — in the browser, the dialog reads naturally in pt-BR and the result screen
    after a quit is the same one a finished test shows.

## Skill notes

- `docs/conventions.md` — no duplication, shared logic in a pure module; the 4 screens are
  quarantined for `max-lines-per-function`, so new logic goes into new files rather than growing
  them (playbooks A/B/C).
- `.claude/library/migration-deploy-contract.md` — not triggered: this slice must produce **no**
  `drizzle/` change.
- Tests: existing plain-vitest setup, no jsdom/RTL, no new dependencies.
- Sequencing: epic #65 slice D1 ([#66](https://github.com/Coghatch-ai/lexflow/issues/66), cross-out)
  edits the same four screens and is not implemented yet — land #66 first to avoid conflicting edits.

## Applied recommendations

| Decision                        | What I applied                                                        | Why                                                                                        |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Slice order inside the epic     | Quit-and-process first, alone; save/resume after the storage decision | Quit needs no persistence and no migration — real user value in one frontend task          |
| Where the exit rules live       | One pure module + unit tests, mirroring `testing-flow-guards.ts`      | The 4 screens are lint-quarantined; duplicating rules in each is the failure mode we avoid |
| Quit with 0 answers             | No call, silent exit                                                  | `sessions.record` input is `answers.min(1)`; an empty run is nothing to process            |
| Result screen after a quit      | Reuse each mode's existing result screen                              | A partial run is a normal session (BR-05.7) — a second result UI would be duplication      |
| Browser tab close in this slice | Native "leave site?" prompt only                                      | Custom recovery needs the persistence that arrives in S2                                   |
| Ordering against #66            | #66 (cross-out) lands first                                           | Same four files; serialising avoids merge pain in quarantined components                   |

## Later

- S2 — server-side in-flight run persistence (contract + procedures), after #67's storage-shape decision.
- S3 — Simulado Padrão: autosave, "Salvar e sair", "Continuar (n/N)" on the mode card, timer pause.
- S4 — Repetição Espaçada + Simulado Adaptativo save/resume (needs the per-mode state answer on #67).
- S5 — Simulado Real: internal autosave + auto-submit on abrupt exit and on timeout, never resumable.
- S6 — mobile runner (Praticar / Drill / Revisão): quit + save/resume, resuming a desktop run.
- Discarding an unfinished run from the mode card (arrives with S3).

## Open questions

None blocking S1. Blocking S2+ (tracked on epic #67, owner senior-analyst): the storage shape that
reuses the existing student/session model, and what per-mode state a resumed run must restore.
