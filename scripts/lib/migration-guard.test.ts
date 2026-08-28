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
//
// This file hit the project's 500-code-line `max-lines` ceiling in review round 7
// and was split BY SUBJECT, never by weakening the rule. What stays here is the
// universe decision (`planMeasurement`, `classifyPushFeed`, `classifyFeedChannel`);
// the siblings hold the parsers it consumes:
//   • ./migration-guard.marker.test.ts — `parseAppliedMarker`,
//     `findUnappliedMigrations`, `classifyPublishedSql`;
//   • ./migration-guard.refs.test.ts   — `resolveDiffTips`, `resolveBaseRef`.

import { describe, expect, it } from "vitest";
import {
  FEED_EMPTY_FALLBACK_REASON,
  FEED_LOST_REASON,
  FEED_NOT_FIFO_REASON,
  HEAD_TIP,
  classifyFeedChannel,
  classifyPublishedSql,
  classifyPushFeed,
  emptyFeedBlockReason,
  findUnappliedMigrations,
  planMeasurement,
  resolveDiffTips,
  type MeasurementPlan,
} from "./migration-guard";

const SHA_A = "f5ced713bfff54b5ae159f5c4dde268a11b102f9";
const SHA_B = "99299d7e88e1f0b0d4c7a2b3e5f6a7b8c9d0e1f2";
const ZERO = "0000000000000000000000000000000000000000";

/**
 * `planMeasurement` on a pipe-shaped fd 0 (git's own feed is one) — the channel every case written before
 * review round 7 implicitly assumed. Keeping it a default here means each case
 * still names only the axis it exercises; the channel axis gets its own suites
 * below, which call `planMeasurement` directly.
 */
function planFifo(
  input: Omit<Parameters<typeof planMeasurement>[0], "feedChannel">,
): MeasurementPlan {
  return planMeasurement({ ...input, feedChannel: "fifo" });
}

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
      planFifo({ rawStdin: REF_LINE, tips: [SHA_A], failure: null, remoteArg: "origin" }),
    ).toEqual({
      kind: "push",
      tips: [SHA_A],
    });
  });

  it("(y) BLOCKS a real push whose diff is impossible — the fork-remote bypass", () => {
    expect(
      planFifo({
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
      planFifo({
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
      planFifo({ rawStdin: "garbage", tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({
      kind: "block",
      reason: FAILURE,
    });
  });

  it("(ab) falls back to the worktree ONLY on a hand run (no stdin at all)", () => {
    expect(
      planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({
      kind: "worktree",
      reason: FAILURE,
    });
  });

  it("(ac) treats blank stdin on a HAND RUN as no stdin (on a real push it blocks — (al))", () => {
    for (const raw of ["", "\n", "   \n\n  "]) {
      expect(
        planFifo({ rawStdin: raw, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
      ).toEqual({
        kind: "worktree",
        reason: FAILURE,
      });
    }
  });

  it("(ad) BLOCKS when there is no stdin but the tips are not the hand-run HEAD", () => {
    expect(planFifo({ rawStdin: null, tips: [SHA_A], failure: FAILURE, remoteArg: null })).toEqual({
      kind: "block",
      reason: FAILURE,
    });
    expect(
      planFifo({
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
      planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: reason, remoteArg: null }),
    ).toEqual({
      kind: "worktree",
      reason,
    });
    expect(
      planFifo({
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
      planFifo({
        rawStdin: stdin,
        tips: resolveDiffTips(stdin),
        failure: FAILURE,
        remoteArg: "origin",
      }).kind,
    ).toBe("block");
    expect(
      planFifo({
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
      const plan = planFifo({
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
      planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: "origin" }),
    ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
  });

  it("(an) BLOCKS a real push whose feed is MALFORMED (5 fields, garbage, bad sha)", () => {
    for (const raw of ["a b c d e", "garbage", `refs/heads/x zzz refs/heads/x ${ZERO}`]) {
      expect(
        planFifo({
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
      expect(planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: arg })).toEqual(
        {
          kind: "block",
          reason: FEED_LOST_REASON,
        },
      );
      expect(
        planFifo({ rawStdin: "garbage", tips: [HEAD_TIP], failure: null, remoteArg: arg }),
      ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
    }
  });

  it("(ao2) an EMPTY feed on a real push measures HEAD whatever shape the remote arg has", () => {
    for (const arg of [
      "../remote.git",
      "https://github.com/Coghatch-ai/lexflow.git",
      "  origin  ",
    ]) {
      expect(planFifo({ rawStdin: "", tips: [HEAD_TIP], failure: null, remoteArg: arg }).kind).toBe(
        "head-fallback",
      );
    }
  });

  it("(ao3) an EMPTY feed whose HEAD diff FAILED blocks — we could not measure anything", () => {
    const plan = planFifo({
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
    expect(planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: null, remoteArg: null })).toEqual({
      kind: "push",
      tips: [HEAD_TIP],
    });
  });

  it("(aq) a HAND RUN whose diff is impossible still takes the ANNOUNCED conservative path", () => {
    expect(
      planFifo({ rawStdin: null, tips: [HEAD_TIP], failure: FAILURE, remoteArg: null }),
    ).toEqual({ kind: "worktree", reason: FAILURE });
    for (const arg of ["", "   "]) {
      expect(
        planFifo({ rawStdin: "", tips: [HEAD_TIP], failure: FAILURE, remoteArg: arg }),
      ).toEqual({ kind: "worktree", reason: FAILURE });
    }
  });

  it("(ar) a CORRECT feed on a real push still measures the pushed tips — and still blocks unapplied SQL", () => {
    const plan = planFifo({
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
      planFifo({ rawStdin: REF_LINE, tips: [SHA_A], failure: FAILURE, remoteArg: "origin" }),
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
    const plan = planFifo({
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
    const plan = planFifo({
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
      const plan = planFifo({
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
      expect(planFifo(input).kind).toBe("block");
    }
  });
});

// ---------------------------------------------------------------------------
// The CHANNEL of an empty feed (#74, review round 7) — the residue round 6 left.
//
// Round 6 accepted an `empty` feed on WHAT was read (zero bytes) without asking
// HOW it arrived, so anything that handed the gate `/dev/null` looked exactly
// like the routine already-up-to-date push and got the head-fallback — which
// passes whenever the local `HEAD` happens to be clean, while a DIFFERENT ref
// published unapplied SQL.
//
// The discriminator was measured, not assumed: git opens a PIPE on fd 0 for
// `pre-push` even with zero refs to write (fifo, 0 bytes) and that FIFO survives
// `git` → `.husky/_/h` → `pre-push` → `pnpm` → `tsx`; `</dev/null`, `0<&-` or an
// empty regular file arrives as a character device or a regular file. It is a
// discriminator, not a proof of provenance — a pipe-shaped substitute (process
// substitution, `mkfifo`) reads `fifo` too, and is the documented residue.
//
// Hermetic: `classifyFeedChannel` takes the fd-0 inspector as a parameter, so
// nothing here touches the real fd 0.
// ---------------------------------------------------------------------------

const EMPTY_FEEDS = ["", "\n", "   \n\n  "] as const;

describe("classifyFeedChannel", () => {
  it("(az) a FIFO on fd 0 is the shape git's feed has — necessary, not sufficient", () => {
    expect(classifyFeedChannel(() => true)).toBe("fifo");
  });

  it("(ba) a non-pipe (char device, regular file) CANNOT be git's feed", () => {
    expect(classifyFeedChannel(() => false)).toBe("not-fifo");
  });

  it("(bb) an fd 0 that cannot even be fstat'ed counts as NOT a FIFO — fail closed", () => {
    expect(
      classifyFeedChannel(() => {
        throw new Error("EBADF: bad file descriptor, fstat");
      }),
    ).toBe("not-fifo");
  });
});

describe("planMeasurement — an EMPTY feed is judged by its CHANNEL", () => {
  it("(bc) empty feed on a pipe ⇒ head-fallback, exactly as before", () => {
    for (const raw of EMPTY_FEEDS) {
      expect(
        planMeasurement({
          rawStdin: raw,
          tips: [HEAD_TIP],
          failure: null,
          remoteArg: "origin",
          feedChannel: "fifo",
        }),
      ).toEqual({ kind: "head-fallback", reason: FEED_EMPTY_FALLBACK_REASON });
    }
  });

  it("(bd) empty feed on a channel that is NOT a FIFO ⇒ BLOCK: git did not hand us that silence", () => {
    for (const raw of EMPTY_FEEDS) {
      expect(
        planMeasurement({
          rawStdin: raw,
          tips: [HEAD_TIP],
          failure: null,
          remoteArg: "origin",
          feedChannel: "not-fifo",
        }),
      ).toEqual({ kind: "block", reason: FEED_NOT_FIFO_REASON });
    }
  });

  it("(be) empty feed whose fd 0 could not be fstat'ed ⇒ BLOCK (throw ⇒ not-fifo ⇒ closed)", () => {
    const feedChannel = classifyFeedChannel(() => {
      throw new Error("EBADF: bad file descriptor, fstat");
    });
    expect(
      planMeasurement({
        rawStdin: "",
        tips: [HEAD_TIP],
        failure: null,
        remoteArg: "origin",
        feedChannel,
      }),
    ).toEqual({ kind: "block", reason: FEED_NOT_FIFO_REASON });
  });

  it("(bf) a swallowed feed blocks whatever the diff did, and whatever shape the remote arg has", () => {
    for (const remoteArg of ["origin", "upstream", "../remote.git", "  origin  "]) {
      for (const failure of [null, FAILURE]) {
        expect(
          planMeasurement({
            rawStdin: "",
            tips: [HEAD_TIP],
            failure,
            remoteArg,
            feedChannel: "not-fifo",
          }).kind,
        ).toBe("block");
      }
    }
  });
});

describe("planMeasurement — the channel changes NOTHING else", () => {
  it("(bg) a CORRECT feed still measures the pushed tips, FIFO or not", () => {
    for (const feedChannel of ["fifo", "not-fifo"] as const) {
      expect(
        planMeasurement({
          rawStdin: REF_LINE,
          tips: [SHA_A],
          failure: null,
          remoteArg: "origin",
          feedChannel,
        }),
      ).toEqual({ kind: "push", tips: [SHA_A] });
    }
  });

  it("(bh) absent/garbled still block with the LOST-feed reason, not the channel one", () => {
    for (const feedChannel of ["fifo", "not-fifo"] as const) {
      for (const rawStdin of [null, "garbage", "a b c d e"]) {
        expect(
          planMeasurement({
            rawStdin,
            tips: [HEAD_TIP],
            failure: null,
            remoteArg: "origin",
            feedChannel,
          }),
        ).toEqual({ kind: "block", reason: FEED_LOST_REASON });
      }
    }
  });

  it("(bi) a HAND RUN (no argv) is untouched — it has no feed by definition", () => {
    for (const feedChannel of ["fifo", "not-fifo"] as const) {
      expect(
        planMeasurement({
          rawStdin: null,
          tips: [HEAD_TIP],
          failure: null,
          remoteArg: null,
          feedChannel,
        }),
      ).toEqual({ kind: "push", tips: [HEAD_TIP] });
      expect(
        planMeasurement({
          rawStdin: null,
          tips: [HEAD_TIP],
          failure: FAILURE,
          remoteArg: null,
          feedChannel,
        }),
      ).toEqual({ kind: "worktree", reason: FAILURE });
    }
  });

  it("(bj) the empty-feed FIFO fallback still blocks when its own diff failed", () => {
    expect(
      planMeasurement({
        rawStdin: "",
        tips: [HEAD_TIP],
        failure: FAILURE,
        remoteArg: "origin",
        feedChannel: "fifo",
      }),
    ).toEqual({ kind: "block", reason: emptyFeedBlockReason(FAILURE) });
  });

  it("(bk) the two block reasons stay distinguishable — each names its own cause", () => {
    expect(FEED_NOT_FIFO_REASON).not.toBe(FEED_LOST_REASON);
    expect(FEED_NOT_FIFO_REASON).not.toBe(FEED_EMPTY_FALLBACK_REASON);
    expect(FEED_NOT_FIFO_REASON).toContain("NÃO foi entregue pelo git");
  });
});
