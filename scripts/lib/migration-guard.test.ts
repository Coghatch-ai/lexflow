// scripts/lib/migration-guard.test.ts
//
// Regression tests for the pre-push migration gate (issue #74; near-miss epic #50,
// where 0025/0026/0027 were pushed unapplied and only a human caught it).
//
// Hermetic by construction: plain vitest over the PURE functions — no fs, no
// git, no mocks, no new dependency. Every impure step lives in
// scripts/check-migrations.ts, which holds no decision logic.
//
// `resolveDiffTips` + `classifyPublishedSql` were extracted OUT of that shell in
// the #74 review round precisely so the two decisions that had zero coverage —
// "what does this push publish" (the third bypass) and "which diff statuses
// count" (the `--diff-filter=d` delta) — are guarded by literal-string cases.

import { describe, expect, it } from "vitest";
import {
  FEED_EMPTY_FALLBACK_REASON,
  FEED_LOST_REASON,
  HEAD_TIP,
  classifyPublishedSql,
  classifyPushFeed,
  emptyFeedBlockReason,
  findUnappliedMigrations,
  parseAppliedMarker,
  planMeasurement,
  resolveBaseRef,
  resolveDiffTips,
} from "./migration-guard";

const SHA_A = "f5ced713bfff54b5ae159f5c4dde268a11b102f9";
const SHA_B = "99299d7e88e1f0b0d4c7a2b3e5f6a7b8c9d0e1f2";
const ZERO = "0000000000000000000000000000000000000000";

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
// resolveDiffTips — the THIRD BYPASS (review round on #74). The gate used to
// diff `origin/main...HEAD`; git tells `pre-push` on stdin what is really being
// published, one line per ref: `<localref> <localsha> <remoteref> <remotesha>`.
// ---------------------------------------------------------------------------

describe("resolveDiffTips", () => {
  it("(h) uses the pushed ref's sha, not HEAD — the `git push origin mig:mig` bypass", () => {
    expect(resolveDiffTips(`refs/heads/mig ${SHA_A} refs/heads/mig ${ZERO}\n`)).toEqual([SHA_A]);
  });

  it("(i) covers every ref of a `git push --all`", () => {
    const stdin = `refs/heads/main ${SHA_B} refs/heads/main ${ZERO}\nrefs/heads/mig ${SHA_A} refs/heads/mig ${ZERO}\n`;
    expect(resolveDiffTips(stdin)).toEqual([SHA_B, SHA_A].sort((a, b) => a.localeCompare(b)));
  });

  it("(j) falls back to HEAD when there is no stdin — a direct `pnpm db:migrate:check`", () => {
    expect(resolveDiffTips(null)).toEqual([HEAD_TIP]);
  });

  it("(k) falls back to HEAD on blank/whitespace-only stdin", () => {
    for (const raw of ["", "\n", "   \n\n  "]) {
      expect(resolveDiffTips(raw)).toEqual([HEAD_TIP]);
    }
  });

  it("(l) skips refs being DELETED (all-zero local sha) ⇒ a delete-only push publishes nothing", () => {
    expect(resolveDiffTips(`refs/heads/gone ${ZERO} refs/heads/gone ${SHA_A}\n`)).toEqual([]);
    expect(resolveDiffTips(`(delete) ${ZERO} refs/heads/gone ${SHA_A}\n`)).toEqual([]);
  });

  it("(m) still measures the live refs when a push mixes a delete with a real ref", () => {
    const stdin = `refs/heads/gone ${ZERO} refs/heads/gone ${SHA_B}\nrefs/heads/mig ${SHA_A} refs/heads/mig ${ZERO}\n`;
    expect(resolveDiffTips(stdin)).toEqual([SHA_A]);
  });

  it("(n) fails conservative to HEAD on an unparseable feed — never silently 'nothing to push'", () => {
    for (const raw of [
      "garbage",
      "a b c",
      `refs/heads/x zzznotasha refs/heads/x ${ZERO}`,
      "a b c d e",
    ]) {
      expect(resolveDiffTips(raw)).toEqual([HEAD_TIP]);
    }
  });

  it("(o) de-duplicates when the same sha is pushed under two refs", () => {
    const stdin = `refs/heads/a ${SHA_A} refs/heads/a ${ZERO}\nrefs/heads/b ${SHA_A} refs/heads/b ${ZERO}\n`;
    expect(resolveDiffTips(stdin)).toEqual([SHA_A]);
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

// ---------------------------------------------------------------------------
// planMeasurement — the FOURTH BYPASS (review round on #74). The shell used to
// swap the measured universe on any degradation: when `origin/main` didn't
// resolve (fork clone, `git remote rename`, `clone --single-branch`) it stopped
// measuring the pushed tips and measured the WORKTREE, so SQL living only in the
// pushed ref was invisible ⇒ exit 0, silently. The choice of universe is pure
// logic and now lives here, with cases.
// ---------------------------------------------------------------------------

const REF_LINE = `refs/heads/mig ${SHA_A} refs/heads/mig ${ZERO}\n`;
const FAILURE = "não foi possível resolver `origin/main` (rode `git fetch origin`)";

describe("planMeasurement", () => {
  it("(x) measures the pushed tips when the diff worked", () => {
    expect(
      planMeasurement({ rawStdin: REF_LINE, tips: [SHA_A], failure: null, remoteArg: "origin" }),
    ).toEqual({
      kind: "push",
      tips: [SHA_A],
    });
  });

  it("(y) BLOCKS a real push whose diff is impossible — the fork-remote bypass", () => {
    expect(
      planMeasurement({
        rawStdin: REF_LINE,
        tips: [SHA_A],
        failure: FAILURE,
        remoteArg: "upstream",
      }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
  });

  it("(z) BLOCKS a multi-ref push (`push --all`) whose diff is impossible", () => {
    const stdin = `refs/heads/main ${SHA_B} refs/heads/main ${ZERO}\n${REF_LINE}`;
    expect(
      planMeasurement({
        rawStdin: stdin,
        tips: [SHA_A, SHA_B],
        failure: FAILURE,
        remoteArg: "origin",
      }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
  });

  it("(aa) BLOCKS a garbled feed whose diff is impossible — stdin exists, so a push exists", () => {
    expect(
      planMeasurement({ rawStdin: "garbage", tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
  });

  it("(ab) falls back to the worktree ONLY on a hand run (no stdin at all)", () => {
    expect(
      planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({
      kind: "worktree",
      reason: FAILURE,
    });
  });

  it("(ac) treats blank stdin on a HAND RUN as no stdin (on a real push it blocks — (al))", () => {
    for (const raw of ["", "\n", "   \n\n  "]) {
      expect(
        planMeasurement({ rawStdin: raw, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
      ).toEqual({
        kind: "worktree",
        reason: FAILURE,
      });
    }
  });

  it("(ad) BLOCKS when there is no stdin but the tips are not the hand-run HEAD", () => {
    expect(
      planMeasurement({ rawStdin: null, tips: [SHA_A], failure: FAILURE, remoteArg: null }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
    expect(
      planMeasurement({
        rawStdin: null,
        tips: [HEAD_TIP, SHA_A],
        failure: FAILURE,
        remoteArg: null,
      }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
  });
});

describe("planMeasurement — reason plumbing", () => {
  it("(ae) carries the reason verbatim, so the shell can print WHY it degraded", () => {
    const reason = "`git diff upstream/main...deadbeef` falhou";
    expect(
      planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: reason, remoteArg: null }),
    ).toEqual({
      kind: "worktree",
      reason,
    });
    expect(
      planMeasurement({
        rawStdin: REF_LINE,
        tips: [SHA_A],
        failure: reason,
        remoteArg: "upstream",
      }),
    ).toEqual({
      kind: "block",
      reason,
    });
  });

  it("(af) end-to-end with resolveDiffTips: a pushed ref + failed diff ⇒ block", () => {
    const stdin = REF_LINE;
    expect(
      planMeasurement({
        rawStdin: stdin,
        tips: resolveDiffTips(stdin),
        failure: FAILURE,
        remoteArg: "origin",
      }).kind,
    ).toBe("block");
    expect(
      planMeasurement({
        rawStdin: null,
        tips: resolveDiffTips(null),
        failure: FAILURE,
        remoteArg: null,
      }).kind,
    ).toBe("worktree");
  });
});

// ---------------------------------------------------------------------------
// planMeasurement + the LOST FEED (review round 5 on #74). Fail-open residue of
// the same class as the third and fourth bypasses: the gate measured the wrong
// commits. `planMeasurement` returned `{kind:"push"}` on ANY successful diff,
// never asking whether `tips` came from git's ref feed or from the `[HEAD_TIP]`
// fallback — so a REAL push whose feed was lost/garbled was measured against
// `HEAD` (another universe) and exited 0 with zero output while the pushed tip
// carried an unapplied `.sql`.
//
// The discriminator is argv: git ALWAYS invokes `pre-push` with two arguments
// (`<remote-name> <remote-url>`), a hand `pnpm db:migrate:check` has none.
// ---------------------------------------------------------------------------

describe("classifyPushFeed", () => {
  it("(ak2) tells git's ref feed apart from every way of NOT having one", () => {
    expect(classifyPushFeed(REF_LINE)).toBe("fed");
    expect(classifyPushFeed(`refs/heads/gone ${ZERO} refs/heads/gone ${SHA_A}\n`)).toBe("fed");
    expect(classifyPushFeed(null)).toBe("absent");
    for (const raw of ["", "\n", "   \n\n  "]) expect(classifyPushFeed(raw)).toBe("empty");
    for (const raw of ["garbage", "a b c", "a b c d e", `refs/heads/x zzz refs/heads/x ${ZERO}`]) {
      expect(classifyPushFeed(raw)).toBe("garbled");
    }
    expect(classifyPushFeed(`${REF_LINE}a b c d e\n`)).toBe("garbled");
  });
});

describe("planMeasurement — a real push whose feed is LOST or EMPTY", () => {
  it("(al) MEASURES instead of concluding when a real push's feed is EMPTY", () => {
    for (const raw of ["", "\n", "   \n\n  "]) {
      const plan = planMeasurement({
        rawStdin: raw,
        tips: [HEAD_TIP],
        failure: null,
        remoteArg: "origin",
      });
      expect(plan.kind).toBe("head-fallback");
      expect(plan).toEqual({ kind: "head-fallback", reason: FEED_EMPTY_FALLBACK_REASON });
    }
  });

  it("(am) BLOCKS a real push whose feed is ABSENT (stdin unreadable ⇒ null)", () => {
    expect(
      planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: "origin" }),
    ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
  });

  it("(an) BLOCKS a real push whose feed is MALFORMED (5 fields, garbage, bad sha)", () => {
    for (const raw of ["a b c d e", "garbage", `refs/heads/x zzz refs/heads/x ${ZERO}`]) {
      expect(
        planMeasurement({
          rawStdin: raw,
          tips: resolveDiffTips(raw),
          failure: null,
          remoteArg: "origin",
        }),
      ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
    }
  });

  it("(ao) BLOCKS on a lost feed even when git passed a URL/path as the remote", () => {
    for (const arg of [
      "../remote.git",
      "https://github.com/Coghatch-ai/lexflow.git",
      "  origin  ",
    ]) {
      expect(
        planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: arg }),
      ).toEqual({
        kind: "block",
        reason: FEED_LOST_REASON,
      });
      expect(
        planMeasurement({ rawStdin: "garbage", tips: [HEAD_TIP], failure: null, remoteArg: arg }),
      ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
    }
  });

  it("(ao2) an EMPTY feed on a real push measures HEAD whatever shape the remote arg has", () => {
    for (const arg of [
      "../remote.git",
      "https://github.com/Coghatch-ai/lexflow.git",
      "  origin  ",
    ]) {
      expect(
        planMeasurement({ rawStdin: "", tips: [HEAD_TIP], failure: null, remoteArg: arg }).kind,
      ).toBe("head-fallback");
    }
  });

  it("(ao3) an EMPTY feed whose HEAD diff FAILED blocks — we could not measure anything", () => {
    const plan = planMeasurement({
      rawStdin: "",
      tips: [HEAD_TIP],
      failure: FAILURE,
      remoteArg: "origin",
    });
    expect(plan.kind).toBe("block");
    expect(plan.kind === "block" ? plan.reason : "").toContain(FAILURE);
    expect(plan).toEqual({ kind: "block", reason: emptyFeedBlockReason(FAILURE) });
  });
});

// The other half of the same function: the two paths the feed-loss work must NOT
// disturb — a HAND RUN (no argv at all, `pnpm db:migrate:check` from a terminal)
// and a real push whose feed arrived intact. Both behaved correctly before the
// gate learned about lost feeds and must keep behaving correctly after.
describe("planMeasurement — a hand run and a CORRECT feed stay untouched", () => {
  it("(ap) a HAND RUN (no argv) is untouched: no stdin + working diff ⇒ measure HEAD", () => {
    expect(
      planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: null }),
    ).toEqual({ kind: "push", tips: [HEAD_TIP] });
  });

  it("(aq) a HAND RUN whose diff is impossible still takes the ANNOUNCED conservative path", () => {
    expect(
      planMeasurement({ rawStdin: null, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({ kind: "worktree", reason: FAILURE });
    for (const arg of ["", "   "]) {
      expect(
        planMeasurement({ rawStdin: "", tips: [HEAD_TIP], failure: FAILURE, remoteArg: arg }),
      ).toEqual({ kind: "worktree", reason: FAILURE });
    }
  });

  it("(ar) a CORRECT feed on a real push still measures the pushed tips — and still blocks unapplied SQL", () => {
    const plan = planMeasurement({
      rawStdin: REF_LINE,
      tips: resolveDiffTips(REF_LINE),
      failure: null,
      remoteArg: "origin",
    });
    expect(plan).toEqual({ kind: "push", tips: [SHA_A] });

    const published = classifyPublishedSql(["A\tdrizzle/0001_evil.sql"]);
    expect(findUnappliedMigrations(published, ["0000_old.sql"])).toEqual(["0001_evil.sql"]);
    expect(findUnappliedMigrations(published, ["0001_evil.sql"])).toEqual([]);
  });

  it("(as) a CORRECT feed whose diff FAILED still blocks with the diff's own reason", () => {
    expect(
      planMeasurement({ rawStdin: REF_LINE, tips: [SHA_A], failure: FAILURE, remoteArg: "origin" }),
    ).toEqual({ kind: "block", reason: FAILURE });
  });
});

// ---------------------------------------------------------------------------
// The EMPTY feed, measured instead of assumed (#74 review round 6).
//
// Round 5 blocked every real push whose feed was not `fed`. Right for `absent`
// and `garbled` (a broken chain), WRONG for `empty`: git starts `pre-push`
// BEFORE filtering refs that are already up to date, so the most ordinary
// `git push` in the world — nothing new to publish — arrives as zero bytes on
// fd 0 and was blocked. A gate that fails on the routine push gets disabled,
// and a disabled gate protects nothing.
//
// The fix concludes NOTHING from an empty feed: it MEASURES `HEAD` against
// `<remote>/main` (`resolveBaseRef`, the base the fed path already uses) and
// decides on what it found — pass only when that diff publishes no unapplied
// `.sql`, block when it does, block when the diff itself is impossible.
// Fail-open is not restored: the pass is verified, not assumed.
// ---------------------------------------------------------------------------

describe("planMeasurement — empty feed on a real push is MEASURED, not assumed", () => {
  it("(at) empty feed + HEAD clean against the base ⇒ PASS (the up-to-date push)", () => {
    const plan = planMeasurement({
      rawStdin: "",
      tips: resolveDiffTips(""),
      failure: null,
      remoteArg: "origin",
    });
    expect(plan.kind).toBe("head-fallback");

    // what the shell then measured over HEAD: no drizzle SQL at all
    const published = classifyPublishedSql(["M\tdrizzle/meta/_journal.json"]);
    expect(published).toEqual([]);
    expect(findUnappliedMigrations(published, [])).toEqual([]);
  });

  it("(au) empty feed + HEAD carrying an UNAPPLIED migration ⇒ BLOCK", () => {
    const plan = planMeasurement({
      rawStdin: "\n",
      tips: resolveDiffTips("\n"),
      failure: null,
      remoteArg: "origin",
    });
    expect(plan.kind).toBe("head-fallback");

    const published = classifyPublishedSql(["A\tdrizzle/0029_evil.sql"]);
    expect(findUnappliedMigrations(published, ["0028_ok.sql"])).toEqual(["0029_evil.sql"]);
  });

  it("(av) empty feed + an applied migration on HEAD ⇒ still PASS (measured, not assumed)", () => {
    const published = classifyPublishedSql(["A\tdrizzle/0028_ok.sql"]);
    expect(findUnappliedMigrations(published, ["0028_ok.sql"])).toEqual([]);
  });

  it("(aw) empty feed + base UNRESOLVABLE ⇒ BLOCK, naming the diff's own reason", () => {
    for (const raw of ["", "\n", "   \n\n  "]) {
      const plan = planMeasurement({
        rawStdin: raw,
        tips: [HEAD_TIP],
        failure: FAILURE,
        remoteArg: "upstream",
      });
      expect(plan.kind).toBe("block");
      expect(plan.kind === "block" ? plan.reason : "").toContain(FAILURE);
      expect(plan).toEqual({ kind: "block", reason: emptyFeedBlockReason(FAILURE) });
    }
  });

  it("(ax) the empty-feed block reason names BOTH halves: the fallback and its failure", () => {
    const reason = emptyFeedBlockReason(FAILURE);
    expect(reason).toContain(FEED_EMPTY_FALLBACK_REASON);
    expect(reason).toContain(FAILURE);
    expect(reason).not.toBe(FEED_LOST_REASON);
  });

  it("(ay) nothing currently blocking was weakened — absent/garbled/failed-diff still block", () => {
    const stillBlocking = [
      { rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: "origin" },
      { rawStdin: "garbage", tips: [HEAD_TIP], failure: null, remoteArg: "origin" },
      { rawStdin: "a b c d e", tips: [HEAD_TIP], failure: null, remoteArg: "origin" },
      { rawStdin: REF_LINE, tips: [SHA_A], failure: FAILURE, remoteArg: "origin" },
      { rawStdin: "", tips: [HEAD_TIP], failure: FAILURE, remoteArg: "origin" },
    ] as const;
    for (const input of stillBlocking) {
      expect(planMeasurement(input).kind).toBe("block");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveBaseRef — git hands `pre-push` `<remote-name> <remote-url>` in argv;
// the gate hardcoded `origin/main` and never read it, which is what made a fork
// clone (remote named `upstream`) degrade on every single push.
// ---------------------------------------------------------------------------

describe("resolveBaseRef", () => {
  it("(ag) uses the remote git is actually pushing to", () => {
    expect(resolveBaseRef("upstream")).toBe("upstream/main");
    expect(resolveBaseRef("fork")).toBe("fork/main");
    expect(resolveBaseRef("origin")).toBe("origin/main");
  });

  it("(ah) falls back to origin/main on a hand run (no argv)", () => {
    expect(resolveBaseRef(null)).toBe("origin/main");
  });

  it("(ai) falls back to origin/main on an empty/whitespace argument", () => {
    for (const arg of ["", "   "]) expect(resolveBaseRef(arg)).toBe("origin/main");
  });

  it("(aj) falls back to origin/main when git passed a URL/path instead of a remote name", () => {
    for (const arg of [
      "https://github.com/Coghatch-ai/lexflow.git",
      "git@github.com:Coghatch-ai/lexflow.git",
      "ssh://git@host/repo.git",
      "../remote.git",
      "/tmp/remote.git",
    ]) {
      expect(resolveBaseRef(arg)).toBe("origin/main");
    }
  });

  it("(ak) trims surrounding whitespace from a real remote name", () => {
    expect(resolveBaseRef("  upstream  ")).toBe("upstream/main");
  });
});
