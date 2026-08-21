# Eliminar alternativas — D1 (QuestionCard + Simulado Padrão)

Epic: [#65](https://github.com/Coghatch-ai/lexflow/issues/65) — slice 1 of 3 (D1 → D2 → M1).

**Goal** — In Simulado Padrão the student can cross out an alternative they are sure is wrong
(swipe the row sideways on touch, or press the ✕ on the row), the crossed-out alternative can no
longer be picked as the answer, and "Responder depois" brings the question back at the end of the
simulado with the cross-outs still there.

## Scope (in)

- New pure module `app/src/shared/lib/eliminations.ts`: session-only eliminated-option state keyed
  by question id (`toggleElimination`, `isEliminated`, `clearForQuestion`) — pure functions,
  unit-tested with plain vitest (no RTL, no new deps).
- `app/src/shared/components/QuestionCard.tsx`: two new optional props
  `eliminatedOptions?: readonly string[]` and `onToggleEliminate?: (option: string) => void`.
  When `onToggleEliminate` is provided each option row renders a ✕ toggle button and accepts a
  horizontal touch-swipe on the row; both call `onToggleEliminate(option)`. Behaviour is unchanged
  when the props are absent (the other three screens keep compiling untouched — they get wired in D2).
- Eliminated row rendering: struck-through + dimmed, `aria-disabled`, `onSelect` NOT fired on click.
- Swipe: native `onTouchStart`/`onTouchEnd` on the row, horizontal delta over a threshold (~60px)
  and dominant over the vertical delta so page scroll is never hijacked. **No new dependency.**
- `app/src/pages/TestingPage.tsx`: hold the eliminated map in component state, pass the two props to
  `QuestionCard`, keep the map across `onPostpone` (moveToEnd) and clear it for a question once its
  answer is recorded.
- pt-BR labels: ✕ button `aria-label` = `Descartar alternativa` / `Restaurar alternativa`.

## Scope (out)

- Simulado Real, Repetição Espaçada, Simulado Adaptativo — D2 (they are lint-quarantined; separate slice).
- Mobile `apps/mobile` QuestionRunner — M1.
- Any DB table / migration / tRPC procedure — cross-outs are session-only by decision.
- Bookmarks, Salvos, notes — untouched.
- Discursive 2ª fase — no alternatives to eliminate.
- Adding "Responder depois" anywhere new — Simulado Padrão already has it.

## Business rules / product facts (user's own words)

- "We should have a option to flag the questions like "Reject" one of the answers, like "drag to the
  side" (to be mobile rady). so the user may flag to answer later, and dont need to analyse again.
  thje goal is to give to the user more options to study, "removing" answers that its sure is not one
  ot then."
- "for ALL testing, not only ONE."
- Persistence: "Only within the current test/session — including when I postpone the question and
  come back to it later in the same session."
- "Im not sure. I've asked to Postpone, right? inside of the session. bookmark is a different
  functionilty alltogheter, that has nothing to do with what Im asking."
- A crossed-out alternative: "Nothing — it cannot be chosen as the answer until you restore it."

## Acceptance

1. `pnpm test` includes new unit tests for `eliminations.ts`: toggling option "B" for question `q1`
   returns a state where `isEliminated(state,'q1','B') === true`; toggling again returns `false`;
   eliminating "B" on `q1` leaves `isEliminated(state,'q2','B') === false`.
2. In Simulado Padrão, pressing the ✕ on an option row renders that row with a line-through class and
   `aria-disabled="true"`; clicking that row afterwards does NOT change `selectedAnswer` (the "Conferir"
   button stays disabled when no other option is selected).
3. Pressing ✕ again on the same row removes the line-through and the row becomes selectable again.
4. A horizontal touch swipe (≥60px, |dx| > |dy|) on an option row produces the same state change as ✕.
5. "Responder depois" on a question with options B and D crossed out: the question returns at the end
   of the queue and both rows still render crossed out. [human check on device/browser]
6. After "Conferir", the green/red correct-answer highlight renders exactly as today; crossed-out rows
   stay dimmed and no cross-out is sent anywhere — `sessions.record` payload is byte-identical to
   before (same fields: questionId, userAnswer, correct, timeSpent).
7. `pnpm validate` passes (tsc + strict ESLint + vitest). `QuestionCard.tsx` and `eliminations.ts` are
   NOT added to the lint quarantine.
8. No file under `drizzle/`, `api/`, or `shared/` changes.

## Skill notes

- `docs/conventions.md`: business logic lives in a pure module (`app/src/shared/lib/`), not inside the
  component; English code, pt-BR display text.
- `CLAUDE.md` NEVER list: no new dependency (`pnpm add` needs explicit approval) → the swipe is hand-rolled
  touch handlers; no `any`, no `!`, no `console.log`.
- Tests: plain vitest only (no jsdom / RTL) — that is why the state lives in a pure module, mirroring
  `testing-flow-guards.ts` (#45).
- `TestingPage.tsx` is lint-quarantined; keep the added code small and do not un-quarantine it here.

## Applied recommendations

| Decision              | What was applied                                                          | Why                                                                        |
| --------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Where the state lives | Pure `app/src/shared/lib/eliminations.ts`, screen holds it in React state | Project rule: logic out of components; unit-testable without RTL           |
| Swipe implementation  | Native touch handlers, threshold 60px, horizontal-dominant                | No dependency may be added without approval                                |
| QuestionCard API      | Two OPTIONAL props; absent props = today's behaviour                      | D2 screens keep compiling untouched; D1 stays one small, verifiable change |
| Cross-out lifetime    | Cleared for a question once its answer is recorded; kept across postpone  | Matches "within the current test", avoids stale marks on a re-run          |
| Labels                | `Descartar alternativa` / `Restaurar alternativa` (pt-BR)                 | UI is pt-BR by convention                                                  |

## Later

- Persist cross-outs across sessions (`user_answer_eliminations` table + router) if the session-only
  version proves useful.
- Auto-eliminate hint modes (e.g. "remove one wrong answer" as a paid aid).
- Keyboard shortcut for elimination on desktop.

## Open questions

None.
