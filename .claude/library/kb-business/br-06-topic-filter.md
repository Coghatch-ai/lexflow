# BR-06 — Estudar por tema (topic filter)

`oab_questions.topic` is a raw pt-BR label, deliberately OUTSIDE BR-01: it is display text, never an
LOV code, and there is no TOPIC LOV. The study setups that offer a topic choice derive their list
from the catalog itself for the chosen discipline.

1. The topic choice is always OPTIONAL (default "Todos os temas") and only meaningful inside one
   discipline.
2. The offered list excludes blank topics and the importer placeholder `( assuntos)`; each entry
   shows its question count.
3. A chosen topic is a HARD filter: a run never mixes in questions from another topic to reach its
   intended length. A topic thinner than the run length runs with what exists.
4. A topic chosen for a run is persisted with the run's setup, so a resumed run is still restricted
   to it — on EVERY client. The mobile runner has no topic picker, yet it shares the `standard`
   draft slot (BR-05.2): it carries the saved topic through its own saves instead of writing the
   run back as unfiltered.
5. "Runs with what exists" includes nothing existing: when the filters match zero questions the
   setup screen stays up with a pt-BR notice. A run never starts with an empty queue.
6. The offered label and the filter are the SAME string, byte for byte. The topic is a raw catalog
   label, so no layer normalises it (no trim, no case fold) on its way to the query — a normalised
   filter would match zero rows for a label the picker advertised with a count.

The long tail of single-question topics and the placeholder rows are a DATA defect, fixed in the
catalog, never worked around in the UI.
