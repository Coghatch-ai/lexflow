# BR-01 — LOV codes in the question catalog

`oab_questions.{discipline,exam_board,difficulty,phase}` stores the English LOV code, never the
pt-BR label. The pt-BR label is display only and lives in the LOV table.

1. Every importer maps label → code before insert.
2. An unmapped label is a hard failure: the importer throws. A raw scraper label is never written.
3. Filters and statistics are keyed by code; a label reaching the catalog silently matches nothing.

History: the CSV seed wrote raw pt-BR discipline labels → the code-keyed filter matched 0 rows
(issue #46).
