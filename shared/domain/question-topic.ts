// shared/domain/question-topic.ts
//
// BR-06, the topic filter of the study setups (issue #102, PRD
// design/study-by-topic.md). `oab_questions.topic` is a RAW pt-BR label the
// importers write, NOT an LOV code: BR-01 covers
// {discipline, exam_board, difficulty, phase} only, so there is no TOPIC LOV
// and no seeded taxonomy — the selectable list is DERIVED from the catalog.
//
// It lives in `shared/` because both sides need the same rule: the router
// filters the grouped rows with it and the setup screens render exactly what it
// returned. A second copy under `api/` or `app/` is how the placeholder would
// reappear on one surface only.

import { z } from "zod";

/**
 * The scraper's placeholder in `oab_questions.topic` (~10% of the catalog). It
 * is never offered as a topic — selecting it would promise a filter and hand
 * back an unrelated pile. The DATA is what has to be fixed (its own issue);
 * this constant only keeps it out of the picker.
 */
export const TOPIC_PLACEHOLDER = "( assuntos)";

/** One selectable topic of a discipline, with how many questions it holds. */
export interface TopicCount {
  topic: string;
  count: number;
}

/**
 * The `topic` filter as it crosses the tRPC boundary (`questions.list`).
 * A blank/whitespace topic is not a filter — the screens send `undefined` for
 * "Todos os temas", never an empty string.
 *
 * It VALIDATES and never TRANSFORMS. `z.string().trim()` is a transform in this
 * repo's zod (4.4.3): it would hand the router a trimmed label while
 * `listableTopics` offers `row.topic` verbatim and the importer writes the
 * column raw (`scripts/seed-from-csv.ts` does not trim `topic`). A label
 * carrying surrounding whitespace would then be offered with its count `n`,
 * reach `eq(oab_questions.topic, <trimmed>)` and match ZERO rows — a run of 0
 * questions from an option that advertised `n` (breaks acceptance 2 and 5).
 * `.refine` keeps the value byte-identical to the one the picker handed out.
 */
export const topicInput = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "O tema não pode ser vazio",
  });

/** The type that filter carries — one topic per run (no multi-select, S1). */
export type TopicInput = z.infer<typeof topicInput>;

/** Is this catalog value a topic a student may pick? (placeholder + blanks out) */
export function isListableTopic(topic: string): boolean {
  const trimmed = topic.trim();
  return trimmed.length > 0 && trimmed !== TOPIC_PLACEHOLDER;
}

/**
 * The picker's list from the catalog's grouped rows: the placeholder and blank
 * topics dropped, empty groups dropped, ordered by the label the student reads.
 *
 * Pure on purpose — the router groups in SQL and hands the rows straight
 * through here, so the rule is provable with plain vitest and has ONE home.
 */
export function listableTopics(rows: readonly TopicCount[]): TopicCount[] {
  return rows
    .filter((row) => isListableTopic(row.topic) && row.count >= 1)
    .map((row) => ({ topic: row.topic, count: row.count }))
    .sort((a, b) => a.topic.localeCompare(b.topic, "pt-BR"));
}

/**
 * The option label: `<tema> (<n>)`. The count is the only honest warning that a
 * topic is thinner than the run — BR-06 runs it anyway with what exists, and
 * never tops it up from another topic.
 */
export function topicOptionLabel(option: TopicCount): string {
  return `${option.topic} (${option.count})`;
}
