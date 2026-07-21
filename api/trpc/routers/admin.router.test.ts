// api/trpc/routers/admin.router.test.ts
//
// Regression guard for the admin.questions.list hasAiExplanation filter.
//
// Option taken: FALLBACK (option 2) — extract + real-code binding.
//   • Imports the REAL listInput schema from admin.router.ts → schema assertions
//     are coupled to the actual production enum; deleting the field or changing
//     its values causes the schema tests to fail.
//   • Imports the REAL aiExplanationFilter helper from admin.router.ts → the
//     SQL-shape tests are coupled to the production predicate; swapping
//     isNull↔isNotNull or removing the condition causes those tests to fail.
//
// How re-introducing the bug fails this suite:
//   • Swap isNull↔isNotNull in aiExplanationFilter → "yes" test expects SQL
//     containing " is not null" but gets " is null" → FAIL.
//   • Drop the conds.push / remove aiExplanationFilter body → "yes" returns
//     undefined instead of a SQL object → FAIL (undefined has no .queryChunks).
//   • Remove hasAiExplanation from listInput → schema parse of "yes"/"no"
//     succeeds with the default ("all") instead of the literal, and the rejects
//     test no longer throws → FAIL.

import { describe, expect, it } from "vitest";
import { aiExplanationFilter, listInput } from "./admin.router";

// ---------------------------------------------------------------------------
// Helper: extract the trailing SQL keyword from a drizzle SQL object.
// queryChunks is [columnRef, …, { value: [" is not null"] }] for isNotNull,
// and [columnRef, …, { value: [" is null"] }] for isNull.
// ---------------------------------------------------------------------------
function sqlKeyword(sql: ReturnType<typeof aiExplanationFilter>): string {
  if (sql === undefined) return "undefined";
  // drizzle SQL objects expose queryChunks; each chunk is either a column
  // reference or a StringChunk with a `value` array of strings.
  const chunks = (sql as { queryChunks: unknown[] }).queryChunks;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i] as { value?: string[] };
    if (
      Array.isArray(chunk.value) &&
      typeof chunk.value[0] === "string" &&
      chunk.value[0].trim().length > 0
    ) {
      return chunk.value[0].trim();
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// 1. Schema assertions — tied to the REAL listInput export
// ---------------------------------------------------------------------------
describe("listInput.hasAiExplanation (real schema)", () => {
  it("defaults to 'all' when omitted", () => {
    const result = listInput.parse({});
    expect(result.hasAiExplanation).toBe("all");
  });

  it("accepts 'yes'", () => {
    expect(listInput.parse({ hasAiExplanation: "yes" }).hasAiExplanation).toBe("yes");
  });

  it("accepts 'no'", () => {
    expect(listInput.parse({ hasAiExplanation: "no" }).hasAiExplanation).toBe("no");
  });

  it("accepts 'all' explicitly", () => {
    expect(listInput.parse({ hasAiExplanation: "all" }).hasAiExplanation).toBe("all");
  });

  it("rejects unknown values", () => {
    expect(() => listInput.parse({ hasAiExplanation: "maybe" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. SQL-shape assertions — tied to the REAL aiExplanationFilter export
//    These fail if isNull↔isNotNull are swapped or the helper body is removed.
// ---------------------------------------------------------------------------
describe("aiExplanationFilter (real helper)", () => {
  it("'all' returns undefined (no condition)", () => {
    expect(aiExplanationFilter("all")).toBeUndefined();
  });

  it("'yes' returns a non-null SQL condition", () => {
    expect(aiExplanationFilter("yes")).toBeDefined();
  });

  it("'no' returns a non-null SQL condition", () => {
    expect(aiExplanationFilter("no")).toBeDefined();
  });

  it("'yes' and 'no' produce DIFFERENT SQL objects", () => {
    const yes = aiExplanationFilter("yes");
    const no = aiExplanationFilter("no");
    expect(yes).not.toBe(no);
    expect(sqlKeyword(yes)).not.toBe(sqlKeyword(no));
  });

  it("'yes' SQL contains 'is not null'", () => {
    expect(sqlKeyword(aiExplanationFilter("yes"))).toBe("is not null");
  });

  it("'no' SQL contains 'is null'", () => {
    expect(sqlKeyword(aiExplanationFilter("no"))).toBe("is null");
  });
});
