// api/trpc/routers/exam-drafts.router.test.ts
//
// Regression guard for the WRITE half of the deadline contract (#79).
//
// The bug: `deadlineAt` refined with `Number.isFinite(Date.parse(v))` — far
// more generous than both Postgres and the read path — so `"2026"` PASSED and
// the `.transform` then normalised it into `"2026-01-01T00:00:00.000Z"`. A
// malformed value became a legitimate-looking deadline on the column that
// force-submits a student's exam.
//
// Binding: imports the REAL `deadlineAtInput` from exam-drafts.router.ts, so
// the assertions are coupled to the production schema, not to a copy.
//
// How re-introducing the bug fails this suite: swap the refine back to
// `Number.isFinite(Date.parse(v))` → "2026" and `new Date(…).toString()` parse
// successfully (and normalise) instead of throwing → FAIL.

import { describe, expect, it } from "vitest";
import { deadlineAtInput } from "./exam-drafts.router";

describe("deadlineAtInput", () => {
  // The values Date.parse invents an instant for and Postgres refuses
  // (22007 / 22023) — the whole point of the strict refine.
  it("recusa um ano solto em vez de normalizá-lo para 1 de janeiro", () => {
    const parsed = deadlineAtInput.safeParse("2026");
    expect(parsed.success).toBe(false);
    // Guards the specific regression: not just "rejected", but never turned
    // into a deadline nobody asked for.
    expect(parsed.success ? parsed.data : null).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("recusa o Date.toString() do JS", () => {
    const jsDateString = new Date("2026-08-21T14:30:04.210Z").toString();
    // Sanity: Date.parse DOES accept it — this is exactly what the old refine
    // let through.
    expect(Number.isFinite(Date.parse(jsDateString))).toBe(true);
    expect(deadlineAtInput.safeParse(jsDateString).success).toBe(false);
  });

  it("recusa lixo e string vazia", () => {
    expect(deadlineAtInput.safeParse("").success).toBe(false);
    expect(deadlineAtInput.safeParse("amanhã").success).toBe(false);
    expect(deadlineAtInput.safeParse("2026-13-45T99:99:99Z").success).toBe(false);
  });

  // The two shapes that ARE legal input keep working, still normalised to ISO.
  it("aceita o ISO do navegador e o texto cru do PG, normalizando para ISO", () => {
    expect(deadlineAtInput.parse("2026-08-21T14:30:04.210Z")).toBe("2026-08-21T14:30:04.210Z");
    expect(deadlineAtInput.parse("2026-08-21 14:30:04.210932+00")).toBe("2026-08-21T14:30:04.210Z");
  });
});
