# BR-05 — Salvar progresso / Sair e processar a test in progress

Surfaces: [../answering-surfaces.md](../answering-surfaces.md). Origin: product-owner interview,
2026-08-20 (epic: save/quit a test in progress).

User intent, verbatim:

> "we have 4 screens to test. if the user change the tab. looses the progression. we need to have a
> option to save for 3. "real test" should give a message, because the goal is to simulate real world.
> but the user may. "quit" so, it will process the answers. the goal is to give the user the hability
> to save the progress OR quit where is. quit should have a option for all, save, only for 3"

> "ask the developer to verify, we already have table for the student. to avoid duplication and
> denormalization. so, be carefull with your direction, to not be solution. only business base"

## The two exits

Every test in progress has exactly two deliberate exits, plus continuing:

- **Salvar e sair** — the run is kept intact and can be continued later, from any device.
- **Sair e processar** — the run ends NOW and the answers already given are processed and recorded.

A student who tries to leave a test in progress is always asked; a test in progress is never
abandoned silently.

## Rules

1. **A student never loses answered work by leaving.** Progress of a test in progress is saved
   automatically as the student answers, without any deliberate action. Switching screen, closing the
   tab, reloading, losing the connection or changing device never destroys answers already given.
2. **Progress is stored server-side, tied to the student account**, so a test started on one device
   can be continued on another. It reuses the existing student/session model — no duplicated data, no
   denormalization. The developer verifies the existing model before adding anything to it.
3. **Salvar e sair exists on the three study modes only**: Simulado Padrão, Repetição Espaçada,
   Simulado Adaptativo.
4. **Sair e processar exists on all four modes**, Simulado Real included.
5. **Simulado Real never offers save and never resumes.** It simulates the real exam: attempting to
   leave shows a warning, and the only choices are continuing the exam or ending it and processing the
   answers. Progress is still stored internally, so that leaving abruptly or the clock running out
   ends the exam through the SAME processing path as Sair e processar — the run is auto-submitted.
   From the student's point of view the exam simply ended; it is never offered back to continue.
6. **Processing counts only what was answered.** Unanswered questions are not errors: they are not
   recorded, do not affect the score, do not touch the SM-2 schedule, and may appear again in a future
   test. This matches the standing rule that a blank answer is never recorded ([BR-03](br-03-postpone.md)).
7. **An incomplete session is real study.** A processed partial run is recorded as a normal session
   and counts in statistics and in the spaced-repetition schedule, exactly like a finished one.
8. **One unfinished test per mode.** Starting a new test in a mode that already has an unfinished one
   asks the student to continue it or discard it; the old run is never overwritten silently.
9. **An unfinished test never expires.** It waits until the student continues it or discards it.
10. **Time does not run while a test is saved.** The elapsed time of a study test pauses when it is
    saved and continues from where it stopped, so time away is never counted as study time.
11. Cross-outs are not part of saved progress ([BR-02](br-02-cross-out.md).3) — a resumed test comes
    back without them.
12. Saved progress is unrelated to Salvos / bookmarks ([BR-04](br-04-bookmarks.md)).

## Scope

All four desktop answering screens AND the mobile runner surfaces (Praticar, Drill, Revisão) — the
rule is about the product, not one client. Discursive (2ª fase) runs are out of scope for now.
