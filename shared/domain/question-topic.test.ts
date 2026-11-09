// shared/domain/question-topic.test.ts
//
// BR-06 regression guard for the topic picker's list (issue #102, acceptance 1).
//
// Binding: imports the REAL `listableTopics` / `isListableTopic` /
// `TOPIC_PLACEHOLDER` the router answers `questions.topics` with, so the
// assertions are coupled to production and not to a copy of the rule.
//
// How re-introducing the bug fails this suite:
//   • drop the `isListableTopic` filter → the `( assuntos)` placeholder and the
//     blank topic come back in the list → FAIL.
//   • compare without `trim()` → `"   "` is offered as a topic → FAIL.
//   • drop the sort → the list comes back in catalog order → FAIL.
//   • make `topicInput` accept `""` → "Todos os temas" would travel as a filter
//     on an empty string and draw zero questions → FAIL.
//   • make `topicInput` TRANSFORM (`z.string().trim()`) → a padded catalog label
//     reaches `eq` trimmed, matches zero rows, and the run draws 0 questions
//     from an option that advertised `n` → FAIL.

import { describe, expect, it } from "vitest";
import {
  TOPIC_PLACEHOLDER,
  isListableTopic,
  listableTopics,
  topicInput,
  topicOptionLabel,
  type TopicCount,
} from "./question-topic";

/** The grouped rows the catalog answers for one discipline, warts included. */
const ROWS: TopicCount[] = [
  { topic: "Controle de Constitucionalidade", count: 7 },
  { topic: TOPIC_PLACEHOLDER, count: 199 },
  { topic: "", count: 3 },
  { topic: "   ", count: 2 },
  { topic: "Direitos Fundamentais", count: 1 },
  { topic: "Ação Civil Pública", count: 4 },
];

describe("listableTopics (BR-06, acceptance 1)", () => {
  it("never offers the importer placeholder — however many questions carry it", () => {
    const topics = listableTopics(ROWS).map((t) => t.topic);
    expect(topics).not.toContain(TOPIC_PLACEHOLDER);
    // The placeholder is the BIGGEST group in the real catalog (~10% of rows),
    // so "it was filtered by count" can never be the reason it is absent.
    expect(ROWS.some((r) => r.topic === TOPIC_PLACEHOLDER && r.count > 100)).toBe(true);
  });

  it("never offers a blank or whitespace-only topic", () => {
    const topics = listableTopics(ROWS).map((t) => t.topic);
    expect(topics).not.toContain("");
    expect(topics).not.toContain("   ");
    expect(topics.every((t) => t.trim().length > 0)).toBe(true);
  });

  it("every offered topic holds at least one question", () => {
    const offered = listableTopics([...ROWS, { topic: "Tema vazio", count: 0 }]);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((t) => t.count >= 1)).toBe(true);
    expect(offered.map((t) => t.topic)).not.toContain("Tema vazio");
  });

  it("orders by the label the student reads (pt-BR), not by catalog order", () => {
    expect(listableTopics(ROWS)).toEqual([
      { topic: "Ação Civil Pública", count: 4 },
      { topic: "Controle de Constitucionalidade", count: 7 },
      { topic: "Direitos Fundamentais", count: 1 },
    ]);
  });

  it("keeps the thin topics — the count is shown, the topic is not hidden (BR-06.3)", () => {
    // A one-question topic is a DATA defect, fixed in the catalog; the picker
    // still offers it and the run takes what exists.
    expect(listableTopics(ROWS)).toContainEqual({ topic: "Direitos Fundamentais", count: 1 });
  });

  it("does not alias the rows it was given", () => {
    const rows: TopicCount[] = [{ topic: "Parte Geral", count: 2 }];
    const offered = listableTopics(rows);
    const first = offered[0];
    if (first === undefined) throw new Error("expected one topic");
    first.count = 99;
    expect(rows[0]?.count).toBe(2);
  });
});

describe("isListableTopic", () => {
  it("accepts a real label and refuses the placeholder and blanks", () => {
    expect(isListableTopic("Parte Geral")).toBe(true);
    expect(isListableTopic(TOPIC_PLACEHOLDER)).toBe(false);
    expect(isListableTopic(` ${TOPIC_PLACEHOLDER} `)).toBe(false);
    expect(isListableTopic("")).toBe(false);
    expect(isListableTopic("\t \n")).toBe(false);
  });
});

describe("topicInput", () => {
  it("refuses an empty/blank filter — 'Todos os temas' sends no topic at all", () => {
    expect(topicInput.safeParse("").success).toBe(false);
    expect(topicInput.safeParse("   ").success).toBe(false);
  });

  it("accepts one topic label", () => {
    expect(topicInput.parse("Controle de Constitucionalidade")).toBe(
      "Controle de Constitucionalidade",
    );
  });

  it("does NOT transform — a padded label survives byte-identical", () => {
    // The catalog's importer writes `topic` raw, and `listableTopics` offers
    // `row.topic` verbatim: if the input schema trimmed (as `z.string().trim()`
    // does), the router would filter on a string the catalog does not hold and
    // the run would draw 0 questions from an option advertising `n`.
    const padded = "  Controle de Constitucionalidade  ";
    expect(topicInput.parse(padded)).toBe(padded);
    expect(topicInput.parse("Tema\t")).toBe("Tema\t");
  });

  it("offers every label `listableTopics` returned, padding included", () => {
    // The two halves of BR-06 must agree: anything the picker can hand out has
    // to pass the filter's schema unchanged.
    const offered = listableTopics([{ topic: " Parte Geral ", count: 3 }]);
    for (const option of offered) {
      expect(topicInput.parse(option.topic)).toBe(option.topic);
    }
  });
});

describe("topicOptionLabel", () => {
  it("renders `<tema> (<n>)` — the honest warning about a thin topic", () => {
    expect(topicOptionLabel({ topic: "Direitos Fundamentais", count: 1 })).toBe(
      "Direitos Fundamentais (1)",
    );
  });
});
