// scripts/lib/migration-guard.marker.test.ts
//
// Regression tests for the two PURE parsers the pre-push migration gate leans on
// (issue #74): the gitignored applied-marker (`parseAppliedMarker` +
// `findUnappliedMigrations`) and the `git diff --name-status` reading
// (`classifyPublishedSql`, the old shell-side `--diff-filter=d`).
//
// Split out of scripts/lib/migration-guard.test.ts when that file reached the
// project's 500-code-line `max-lines` ceiling. Same hermetic style: plain vitest
// over pure functions — no fs, no git, no mocks, no new dependency. The universe
// decisions (`planMeasurement`, feed class, feed CHANNEL) stay in the sibling.

import { describe, expect, it } from "vitest";
import {
  classifyPublishedSql,
  findUnappliedMigrations,
  parseAppliedMarker,
} from "./migration-guard";

// ---------------------------------------------------------------------------
// parseAppliedMarker — the marker is gitignored per-machine state, so every
// "we can't read it" path must degrade to [] (which makes the gate fail closed
// once there are candidates).
// ---------------------------------------------------------------------------

describe("parseAppliedMarker", () => {
  it("parses a valid marker written by scripts/migrate.ts", () => {
    expect(parseAppliedMarker('["0001_a.sql", "0002_b.sql"]')).toEqual([
      "0001_a.sql",
      "0002_b.sql",
    ]);
  });

  it("returns [] when the marker is absent (raw = null)", () => {
    expect(parseAppliedMarker(null)).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(parseAppliedMarker("{not json")).toEqual([]);
  });

  it("returns [] when the shape is an object, not an array", () => {
    expect(parseAppliedMarker('{"a":1}')).toEqual([]);
  });

  it("returns [] when the array holds a non-string", () => {
    expect(parseAppliedMarker('["x", 2]')).toEqual([]);
  });

  it("normalizes marker entries to basenames", () => {
    expect(parseAppliedMarker('["drizzle/0003_c.sql"]')).toEqual(["0003_c.sql"]);
  });
});

// ---------------------------------------------------------------------------
// findUnappliedMigrations — `published` is what THIS push publishes
// (git diff origin/main...HEAD -- drizzle), never every .sql on disk.
// ---------------------------------------------------------------------------

describe("findUnappliedMigrations", () => {
  it("(a) flags a published migration missing from the marker — the epic #50 regression", () => {
    expect(findUnappliedMigrations(["drizzle/0026_drop_table.sql"], ["0025_x.sql"])).toEqual([
      "0026_drop_table.sql",
    ]);
  });

  it("(b) returns [] when every published migration is in the marker", () => {
    expect(
      findUnappliedMigrations(
        ["drizzle/0025_x.sql", "drizzle/0026_y.sql"],
        ["0025_x.sql", "0026_y.sql"],
      ),
    ).toEqual([]);
  });

  it("(c) returns [] when the push publishes no SQL, even with no marker — a fresh clone passes", () => {
    expect(findUnappliedMigrations([], parseAppliedMarker(null))).toEqual([]);
  });

  it("(d) fails closed: published SQL + unusable marker ⇒ every candidate comes back", () => {
    const published = ["drizzle/0028_a.sql", "drizzle/0029_b.sql"];
    const expected = ["0028_a.sql", "0029_b.sql"];

    for (const raw of [null, "{not json", '{"a":1}', '["x", 2]']) {
      expect(findUnappliedMigrations(published, parseAppliedMarker(raw))).toEqual(expected);
    }
  });

  it("(e) ignores stale/extra marker entries for files that no longer exist", () => {
    expect(
      findUnappliedMigrations(
        ["drizzle/0028_a.sql"],
        ["0001_gone.sql", "0028_a.sql", "0099_z.sql"],
      ),
    ).toEqual([]);
  });

  it("(f) matches a git path candidate against a basename marker entry", () => {
    expect(findUnappliedMigrations(["drizzle/0028_x.sql"], ["0028_x.sql"])).toEqual([]);
  });

  it("(g) returns a sorted, de-duplicated list", () => {
    expect(
      findUnappliedMigrations(
        ["drizzle/0030_c.sql", "0028_a.sql", "drizzle/0028_a.sql", "drizzle/0029_b.sql"],
        [],
      ),
    ).toEqual(["0028_a.sql", "0029_b.sql", "0030_c.sql"]);
  });
});

// ---------------------------------------------------------------------------
// classifyPublishedSql — the `--diff-filter=d` decision, moved out of the shell
// so it is actually guarded. Input is raw `git diff --name-status` lines.
// ---------------------------------------------------------------------------

describe("classifyPublishedSql", () => {
  it("(p) keeps added and modified SQL", () => {
    expect(classifyPublishedSql(["A\tdrizzle/0028_a.sql", "M\tdrizzle/0029_b.sql"])).toEqual([
      "drizzle/0028_a.sql",
      "drizzle/0029_b.sql",
    ]);
  });

  it("(q) DROPS deletions — a branch that only removes a migration publishes no SQL", () => {
    expect(classifyPublishedSql(["D\tdrizzle/0028_a.sql"])).toEqual([]);
  });

  it("(r) keeps the DESTINATION of a rename — republished under a new name, never applied as such", () => {
    expect(classifyPublishedSql(["R100\tdrizzle/0028_old.sql\tdrizzle/0028_new.sql"])).toEqual([
      "drizzle/0028_new.sql",
    ]);
  });

  it("(s) keeps the destination of a copy too", () => {
    expect(classifyPublishedSql(["C75\tdrizzle/0028_a.sql\tdrizzle/0030_c.sql"])).toEqual([
      "drizzle/0030_c.sql",
    ]);
  });

  it("(t) drops non-.sql paths, including the gitignored marker", () => {
    expect(
      classifyPublishedSql(["M\tdrizzle/meta/_applied.json", "M\tdrizzle/meta/_journal.json"]),
    ).toEqual([]);
  });

  it("(u) ignores blank and malformed lines", () => {
    expect(classifyPublishedSql(["", "   ", "A", "A\tdrizzle/0028_a.sql"])).toEqual([
      "drizzle/0028_a.sql",
    ]);
  });

  it("(v) mixed diff: only the survivors reach the marker comparison", () => {
    const published = classifyPublishedSql([
      "D\tdrizzle/0026_gone.sql",
      "A\tdrizzle/0028_a.sql",
      "R100\tdrizzle/0027_old.sql\tdrizzle/0027_new.sql",
      "M\tdrizzle/meta/_journal.json",
    ]);
    expect(published).toEqual(["drizzle/0027_new.sql", "drizzle/0028_a.sql"]);
    expect(findUnappliedMigrations(published, ["0028_a.sql"])).toEqual(["0027_new.sql"]);
  });

  it("(w) keeps other statuses (T/U) rather than guessing them safe", () => {
    expect(classifyPublishedSql(["T\tdrizzle/0028_a.sql", "U\tdrizzle/0029_b.sql"])).toEqual([
      "drizzle/0028_a.sql",
      "drizzle/0029_b.sql",
    ]);
  });
});
