# BR-03 — "Responder depois" is postpone-within-the-test, NOT bookmark

Origin: epic #65.

User intent, verbatim:

> "Im not sure. I've asked to Postpone, right? inside of the session. bookmark is a different
> functionilty alltogheter, that has nothing to do with what Im asking."

Rules:

1. "Responder depois" moves the current question to the END of the current test queue (in real-exam
   mode the cursor jumps to the next unanswered one). It NEVER records a blank answer.
2. It is available only BEFORE the answer is checked and only while other questions remain.
3. A postponed question returns with the student's cross-outs intact ([BR-02](br-02-cross-out.md)).
4. It is unrelated to bookmarks / Salvos ([BR-04](br-04-bookmarks.md)). Never conflate the two,
   never auto-bookmark a postponed question.

## How rule 1 applies per queue shape (decided in #70, epic #65 D2)

"End of the current test queue" is literal only where a queue is materialized. Per screen:

| Screen              | Queue shape                                                 | "End of the queue" means                                                                                               |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Simulado Padrão     | materialized array + cursor                                 | `moveToEnd(questions, currentIndex)`, cursor stays put                                                                 |
| Repetição Espaçada  | materialized array of ≤5 reviews + forward-only cursor      | `moveToEnd(reviewQuestions, currentIndex)`, cursor stays put                                                           |
| Simulado Real       | fixed 80 questions, free navigation                         | cursor jumps to the next unanswered (`findNextUnanswered`); the question keeps its slot and an "Adiada" badge          |
| Simulado Adaptativo | NO queue — each question is drawn from a pool by difficulty | explicit FIFO `deferred`, drained at the TAIL of the simulado (`shouldServeDeferred` in `shared/domain/exam-queue.ts`) |
| Runner mobile (#85) | materialized array + cursor                                 | `moveToEnd(queue, currentIndex)`, cursor stays put; offered only before the instant reveal                             |

Adaptive specifics (they follow from rule 1, they are not new intent):

- Postponing draws a substitute AT THE SAME DIFFICULTY: nothing was answered, so there is no signal
  for `nextDifficulty`.
- Postponing moves NOTHING in the adaptive state — not `totalAnswered`, not `consecutiveCorrect` /
  `consecutiveWrong`, not `difficultyHistory` — and never records a blank answer.
- Postponing is offered only while the remaining slots still fit the deferred question plus at least
  one other (`canPostponeAdaptive`), so a postpone can never shrink the simulado's answered total.
- Without the explicit FIFO the postponed question would stay in `questions`, `fetchQuestion` would
  treat it as already seen and it would NEVER come back — postponing would silently discard it, the
  opposite of rule 1. That is what `exam-queue.test.ts › shouldServeDeferred` guards.

## SM-2 is never touched by a postpone

Re-ordering the Repetição Espaçada session queue does NOT move a card's schedule: SM-2 only advances
in `sessions.record`, and a postpone records nothing (rule 1). Same for the adaptive difficulty
ladder — only an answer moves it.
