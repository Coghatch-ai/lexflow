# BR-02 — Descartar alternativas (cross-out) — a study aid, never data

Surfaces: [../answering-surfaces.md](../answering-surfaces.md). Origin: epic #65
(product-owner interview, 2026-08-20).

User intent, verbatim:

> "We should have a option to flag the questions like "Reject" one of the answers, like "drag to the
> side" (to be mobile rady). so the user may flag to answer later, and dont need to analyse again.
> thje goal is to give to the user more options to study, "removing" answers that its sure is not one
> ot then."

> "for ALL testing, not only ONE."

Rules:

1. In EVERY multiple-choice answering surface the student can cross out an alternative they judge
   wrong: swipe the option row sideways on touch, or press the ✕ on the row. The same action restores it.
2. A crossed-out alternative is dimmed + struck through and CANNOT be selected as the answer until
   restored — verbatim: _"Nothing — it cannot be chosen as the answer until you restore it."_
3. Cross-outs are **session-only** — verbatim: _"Only within the current test/session — including when
   I postpone the question and come back to it later in the same session."_ They are NEVER persisted:
   no table, no procedure, nothing in the recorded session payload.
4. Cross-outs NEVER affect score, statistics or the SM-2 spaced-repetition schedule, and never appear
   in Salvos.
5. Once the answer is checked, the green/red correct-answer highlight takes over; crossed-out rows just
   stay dimmed.
6. Discursive (2ª fase) questions are out of scope — they have no alternatives.

Interaction with a saved test ([BR-05](br-05-save-quit-test.md)): cross-outs are not part of saved
progress. A test resumed later comes back without them.
