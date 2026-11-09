// api/trpc/routers/questions.router.test.ts
//
// BR-06 regression guard for the `topic` filter of `questions.list` (issue
// #102, acceptance 2 and 3).
//
// Binding: imports the REAL `listInput` schema and the REAL `listConditions`
// predicate builder from questions.router.ts, and compiles the conditions with
// drizzle's own PG dialect — so the assertions are about the SQL production
// sends, not about a hand-written copy of it.
//
// How re-introducing the bug fails this suite:
//   • drop the `topic` push from listConditions → the WHERE of a topic-filtered
//     draw has no `"topic" = $n` and comes back with the whole discipline →
//     FAIL ("filters on the chosen topic").
//   • push the topic condition unconditionally (`eq(topic, input.topic)` with
//     an undefined input) → the no-topic WHERE stops matching the pre-change
//     SQL → FAIL ("the WHERE is unchanged without a topic").
//   • remove `topic` from listInput → the schema drops the field and the
//     parsed input carries no topic → FAIL (both schema and SQL tests).

import { describe, expect, it } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { listConditions, listInput, type ListInput } from "./questions.router";

const dialect = new PgDialect();

/** The WHERE `questions.list` would run, as SQL text + bound parameters. */
function whereOf(input: ListInput): { sql: string; params: unknown[] } {
  const conds = listConditions(input);
  // `and()` answers undefined for an empty list — the "no filters" WHERE, which
  // the router expresses as `.where(undefined)`.
  const combined = conds.length > 0 ? and(...conds) : undefined;
  if (combined === undefined) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(combined);
  return { sql: query.sql, params: [...query.params] };
}

const DISCIPLINE = "CONSTITUTIONAL_LAW";
const TOPIC = "Controle de Constitucionalidade";

describe("questions.list input (BR-06)", () => {
  it("accepts a topic and keeps it verbatim (a raw pt-BR label, not an LOV code)", () => {
    const parsed = listInput.parse({ discipline: DISCIPLINE, topic: TOPIC, limit: 10 });
    expect(parsed.topic).toBe(TOPIC);
  });

  it("stays optional — the pre-change input still parses, with no topic", () => {
    const parsed = listInput.parse({ discipline: DISCIPLINE, limit: 10 });
    expect(parsed.topic).toBeUndefined();
  });

  it("refuses an empty topic (a blank select is 'Todos os temas', not a filter)", () => {
    expect(listInput.safeParse({ discipline: DISCIPLINE, topic: "", limit: 10 }).success).toBe(
      false,
    );
  });
});

describe("listConditions (acceptance 2: a topic-filtered draw)", () => {
  it("filters on the chosen topic, bound as a parameter", () => {
    const where = whereOf(listInput.parse({ discipline: DISCIPLINE, topic: TOPIC, limit: 10 }));
    expect(where.sql).toContain('"topic" = $');
    expect(where.params).toContain(TOPIC);
  });

  it("binds the label VERBATIM — padding included, so a padded row still matches", () => {
    // `listableTopics` offers `row.topic` untouched and the importer writes the
    // column raw, so the schema must not trim: the bound parameter has to be
    // byte-identical to the option the student picked, or `eq` matches 0 rows
    // and the run draws nothing from an option that advertised a count.
    const padded = `  ${TOPIC}  `;
    const parsed = listInput.parse({ discipline: DISCIPLINE, topic: padded, limit: 10 });
    expect(parsed.topic).toBe(padded);
    const where = whereOf(parsed);
    expect(where.sql).toContain('"topic" = $');
    expect(where.params).toEqual([DISCIPLINE, padded]);
  });

  it("adds the topic ON TOP of the discipline — one topic of one discipline", () => {
    const conds = listConditions(listInput.parse({ discipline: DISCIPLINE, topic: TOPIC }));
    expect(conds).toHaveLength(2);
    const where = whereOf(listInput.parse({ discipline: DISCIPLINE, topic: TOPIC }));
    expect(where.sql).toContain('"discipline" = $');
    expect(where.params).toEqual([DISCIPLINE, TOPIC]);
  });
});

describe("listConditions (acceptance 3: unchanged without a topic)", () => {
  // The pre-change WHERE, for each shape the callers actually send. Written out
  // instead of derived, so a condition sneaking in for an absent filter cannot
  // pass by being added to both sides.
  const unchanged: { name: string; input: Partial<ListInput>; sql: string; params: unknown[] }[] = [
    { name: "no filters at all", input: {}, sql: "", params: [] },
    {
      name: "discipline only",
      input: { discipline: DISCIPLINE },
      sql: '"oab_questions"."discipline" = $1',
      params: [DISCIPLINE],
    },
    {
      name: "the full pre-BR-06 filter set",
      input: {
        discipline: DISCIPLINE,
        examBoard: "FGV",
        difficulty: "medium",
        phase: "1st",
      },
      sql: '("oab_questions"."discipline" = $1 and "oab_questions"."exam_board" = $2 and "oab_questions"."difficulty" = $3 and "oab_questions"."phase" = $4)',
      params: [DISCIPLINE, "FGV", "medium", "1st"],
    },
  ];

  for (const shape of unchanged) {
    it(`builds the same WHERE as before BR-06 — ${shape.name}`, () => {
      const where = whereOf(listInput.parse({ ...shape.input, limit: 10 }));
      expect(where.sql).toBe(shape.sql);
      expect(where.params).toEqual(shape.params);
      expect(where.sql).not.toContain("topic");
    });
  }

  it("never references topic for a caller that sends none", () => {
    for (const shape of unchanged) {
      const conds = listConditions(listInput.parse({ ...shape.input, limit: 10 }));
      expect(conds).toHaveLength(shape.params.length);
    }
  });
});
