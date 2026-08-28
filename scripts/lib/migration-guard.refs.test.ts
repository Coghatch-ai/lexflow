// scripts/lib/migration-guard.refs.test.ts
//
// Regression tests for the two PURE ref/argv readings the pre-push migration
// gate does before it decides anything (issue #74):
//   • `resolveDiffTips`  — WHAT this push publishes, read off the `pre-push`
//     stdin instead of `HEAD` (the third bypass);
//   • `resolveBaseRef`   — WHAT it is compared against, read off the remote NAME
//     git passes as `$1` instead of a hardcoded `origin/main` (the fourth).
//
// Split out of scripts/lib/migration-guard.test.ts when that file reached the
// project's 500-code-line `max-lines` ceiling. Same hermetic style: plain vitest
// over pure functions — no fs, no git, no mocks, no new dependency.

import { describe, expect, it } from "vitest";
import { HEAD_TIP, resolveBaseRef, resolveDiffTips } from "./migration-guard";

const SHA_A = "f5ced713bfff54b5ae159f5c4dde268a11b102f9";
const SHA_B = "99299d7e88e1f0b0d4c7a2b3e5f6a7b8c9d0e1f2";
const ZERO = "0000000000000000000000000000000000000000";
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
