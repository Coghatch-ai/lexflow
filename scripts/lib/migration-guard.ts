// scripts/lib/migration-guard.ts
//
// Pure core of the pre-push migration gate (`pnpm db:migrate:check`, wired in
// .husky/pre-push). NO fs, NO git, NO process/env — every impure step lives in
// scripts/check-migrations.ts, so this file is unit-testable with plain vitest
// (scripts/lib/migration-guard.test.ts).
//
// Contract (see .claude/library/migration-deploy-contract.md):
//   • "unapplied" is scoped to what the push PUBLISHES — the caller diffs
//     `<remote>/main...<tip>` (`resolveBaseRef`; `origin/main` only on a hand run)
//     for every tip the push actually publishes (read off the pre-push stdin),
//     never every .sql on disk.
//   • the apply-time marker `drizzle/meta/_applied.json` is gitignored per-machine
//     state, so a missing/corrupt marker means "we know nothing" → with candidates
//     present that must FAIL CLOSED (every candidate comes back as unapplied).

import { z } from "zod";

/** Diff tip used when there is no pre-push stdin (manual `pnpm db:migrate:check`). */
export const HEAD_TIP = "HEAD";

/** git's "this ref is being deleted" local sha: all zeros (40 or 64 chars). */
const DELETION_SHA = /^0+$/;

/** A real object name. Loose on length so sha-256 repos parse too. */
const OBJECT_SHA = /^[0-9a-f]{7,64}$/;

interface PushRefLine {
  readonly localSha: string;
  readonly isDeletion: boolean;
}

/**
 * One pre-push stdin line: `<localref> <localsha> <remoteref> <remotesha>`.
 * Anything that is not exactly that shape ⇒ `null` (caller degrades).
 */
function parsePushRefLine(line: string): PushRefLine | null {
  const fields = line
    .trim()
    .split(/\s+/)
    .filter((field) => field !== "");
  if (fields.length !== 4) return null;

  const localSha = fields[1];
  if (localSha === undefined) return null;
  if (DELETION_SHA.test(localSha)) return { localSha, isDeletion: true };
  if (!OBJECT_SHA.test(localSha)) return null;

  return { localSha, isDeletion: false };
}

/**
 * The commits THIS push publishes — the tips the gate must diff against
 * `<remote>/main` (`resolveBaseRef`).
 *
 * git feeds `pre-push` one line per ref on stdin. Measuring `HEAD` instead (as
 * this gate first did) is a bypass: `git push origin mig:mig` while `main` is
 * checked out, `git push --all`, and `push.default=matching` all publish refs
 * that HEAD knows nothing about, so the gate saw zero candidates and passed
 * while unapplied SQL went out (issue #74, third bypass).
 *
 * Rules, all conservative:
 *   • `null` / blank stdin  ⇒ `[HEAD_TIP]` — a direct `pnpm db:migrate:check`
 *     has no stdin, and must still check something rather than nothing;
 *   • any unparseable line  ⇒ `[HEAD_TIP]` — never trust a garbled feed enough
 *     to conclude "nothing is being pushed";
 *     ⚠ `[HEAD_TIP]` is a HAND-RUN universe only. On a real push it is not a
 *     conservative answer, it is the WRONG one — `planMeasurement` (via
 *     `classifyPushFeed`) blocks instead of measuring it;
 *   • all-zero local sha    ⇒ skipped (that ref is being DELETED, so it
 *     publishes no SQL) — a push that only deletes refs yields `[]`;
 *   • otherwise             ⇒ every distinct local sha, sorted.
 */
export function resolveDiffTips(rawStdin: string | null): string[] {
  if (rawStdin === null) return [HEAD_TIP];

  const lines = rawStdin.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [HEAD_TIP];

  const tips = new Set<string>();
  for (const line of lines) {
    const parsed = parsePushRefLine(line);
    if (parsed === null) return [HEAD_TIP];
    if (parsed.isDeletion) continue;
    tips.add(parsed.localSha);
  }

  return [...tips].sort((a, b) => a.localeCompare(b));
}

/**
 * What the gate is allowed to MEASURE, once the shell knows whether it could
 * diff the pushed tips at all.
 *
 *   • `push`          ⇒ diff worked; the candidate set is what those tips publish;
 *   • `head-fallback` ⇒ a real push whose ref feed arrived EMPTY: we conclude
 *     nothing from the feed and judge by what `HEAD` publishes against the base.
 *     Passing requires that measurement to come back clean (see below);
 *   • `worktree`      ⇒ conservative approximation over every `.sql` on disk.
 *     Only ever legitimate for a hand run (no stdin), where "the push" does not exist;
 *   • `block`         ⇒ this push publishes something we could not read. Fail closed.
 */
export type MeasurementPlan =
  | { readonly kind: "push"; readonly tips: readonly string[] }
  | { readonly kind: "head-fallback"; readonly reason: string }
  | { readonly kind: "worktree"; readonly reason: string }
  | { readonly kind: "block"; readonly reason: string };

/** Where the tips being measured came from — git's ref feed, or the fallback. */
export type FeedSource = "fed" | "empty" | "garbled" | "absent";

/**
 * Classify the pre-push stdin, so the caller can tell "git told us what this
 * push publishes" (`fed`) from "we never got the list" (`empty`/`garbled`/
 * `absent`). `resolveDiffTips` flattens the last three into `[HEAD_TIP]`, which
 * is only ever a legitimate universe on a HAND run.
 */
export function classifyPushFeed(rawStdin: string | null): FeedSource {
  if (rawStdin === null) return "absent";

  const lines = rawStdin.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return "empty";

  for (const line of lines) {
    if (parsePushRefLine(line) === null) return "garbled";
  }

  return "fed";
}

/**
 * Why a real push whose ref feed is BROKEN (`absent` / `garbled`) is blocked
 * (printed as `Motivo:`). An EMPTY feed is NOT this case — see
 * `FEED_EMPTY_FALLBACK_REASON`.
 */
export const FEED_LOST_REASON =
  "git não forneceu no stdin uma lista de refs legível para este push (feed ausente ou ilegível); " +
  "sem ela o gate só poderia medir `HEAD`, que NÃO responde pelo que o push publica";

/**
 * Why a real push with an EMPTY ref feed is MEASURED against `HEAD` instead of
 * blocked outright. git starts `pre-push` BEFORE filtering refs that are already
 * up to date, so an ordinary `git push` with nothing new to publish arrives as
 * zero bytes on fd 0 — indistinguishable from a wrapper that swallowed the feed.
 * Blocking it would fail the most routine push there is, and a gate that annoys
 * gets disabled; passing it blindly would restore the fail-open hole. So the gate
 * concludes NOTHING from the feed and measures instead.
 */
export const FEED_EMPTY_FALLBACK_REASON =
  "git não forneceu no stdin a lista de refs deste push (feed vazio — é o que um push " +
  "já atualizado produz); o gate não concluiu nada do feed e mediu `HEAD` contra a base";

/**
 * The empty-feed fallback could not measure either — block, naming both halves:
 * why we fell back to `HEAD`, and why that measurement failed.
 */
export function emptyFeedBlockReason(failure: string): string {
  return `${FEED_EMPTY_FALLBACK_REASON} — e essa medição também falhou: ${failure}`;
}

/**
 * WHICH UNIVERSE the gate measures — the **fourth bypass** found on #74, and the
 * same shape as the third: the gate looked at the wrong commits.
 *
 * The old shell degraded to `allSqlOnDisk(root)` whenever `origin/main` was
 * unresolvable or a `git diff` failed. That silently SWAPS the universe: the
 * worktree is not the push. In a clone whose remote is not named `origin` (a
 * fork, `git remote rename`, `clone --single-branch --branch <not-main>`),
 * `origin/main` never resolves, so **every** push degraded — and with the
 * worktree fully applied the candidate set was empty ⇒ `exit 0`, in silence,
 * while the pushed tip carried unapplied SQL.
 *
 * The **fifth residue**, closed in the next review round: the rule below used to
 * be "diff succeeded ⇒ measure the tips", full stop — it never asked WHERE the
 * tips came from. `resolveDiffTips` returns `[HEAD_TIP]` both for a hand run and
 * for a real push whose feed was lost/garbled, so a working diff over a lost
 * feed measured `HEAD` — a different universe — and exited 0 having inspected
 * nothing, while the pushed tip carried unapplied SQL. Fail-OPEN in a control
 * whose every other path fails closed. `remoteArg` is the discriminator: git
 * ALWAYS invokes `pre-push` with `<remote-name> <remote-url>`, a hand
 * `pnpm db:migrate:check` has no argv at all.
 *
 * The **sixth round** split the previous "feed not `fed` ⇒ block" rule by feed
 * class. `absent`/`garbled` is a broken chain and still blocks. `empty` is NOT:
 * git starts `pre-push` before filtering already-up-to-date refs, so the most
 * ordinary push in the world arrives as zero bytes and was being blocked — and a
 * gate that fails on the routine push gets parked in a `.zshrc`, after which it
 * protects nothing. The answer is neither "block" nor "pass": conclude nothing
 * from the feed and MEASURE `HEAD` against the base (`head-fallback`), passing
 * only if that measurement comes back clean, blocking if it shows unapplied SQL
 * and blocking if it cannot run at all. Verified, never assumed — and no
 * currently-blocking path was weakened.
 *
 * Rules (feed check FIRST — it is the one that decides which universe is even
 * legitimate):
 *   • real push (argv present) + feed `absent`/`garbled` ⇒ **block**: we never
 *     learned what this push publishes, and `HEAD` does not answer for it;
 *   • real push + feed `empty` + diff worked   ⇒ `head-fallback` (measure `HEAD`);
 *   • real push + feed `empty` + diff failed   ⇒ **block**: nothing was measured;
 *   • diff succeeded (`failure === null`)      ⇒ measure the pushed tips;
 *   • failure + git actually fed us a ref list ⇒ **block**: we cannot say what
 *     this push publishes, and "don't know" is not "nothing";
 *   • failure + no stdin at all (`null`/blank) ⇒ a hand `pnpm db:migrate:check`,
 *     where the only meaningful universe IS the disk ⇒ `worktree`, and the shell
 *     must SAY it ran degraded (a silent degraded pass is what hid this bypass);
 *   • failure + no stdin but tips ≠ `[HEAD_TIP]` (not reachable today; the shell
 *     derives one from the other) ⇒ block, because the disk would not answer for
 *     those tips either.
 */
export function planMeasurement(input: {
  readonly rawStdin: string | null;
  readonly tips: readonly string[];
  readonly failure: string | null;
  readonly remoteArg: string | null;
}): MeasurementPlan {
  const { rawStdin, tips, failure, remoteArg } = input;

  const isRealPush = remoteArg !== null && remoteArg.trim() !== "";
  if (isRealPush) {
    const feed = classifyPushFeed(rawStdin);
    if (feed === "absent" || feed === "garbled") {
      return { kind: "block", reason: FEED_LOST_REASON };
    }
    if (feed === "empty") {
      return failure === null
        ? { kind: "head-fallback", reason: FEED_EMPTY_FALLBACK_REASON }
        : { kind: "block", reason: emptyFeedBlockReason(failure) };
    }
  }

  if (failure === null) return { kind: "push", tips };

  const fedByGit = rawStdin !== null && rawStdin.trim() !== "";
  if (fedByGit) return { kind: "block", reason: failure };

  const isHandRun = tips.length === 1 && tips[0] === HEAD_TIP;
  return isHandRun ? { kind: "worktree", reason: failure } : { kind: "block", reason: failure };
}

/** Looks like a URL / filesystem path rather than a configured remote NAME. */
const REMOTE_URL_SHAPE = /[/:@]|^\.+$/;

/**
 * The ref the push is measured against, from the remote name git hands
 * `pre-push` as `$1` (`<remote-name> <remote-url>`), forwarded by
 * `.husky/pre-push` as `pnpm db:migrate:check "$@"`.
 *
 * The old fixed `origin/main` hardcoded remote AND branch while the real remote
 * name sat unread in `argv` — which is exactly what made a fork clone (remote
 * named `upstream`) degrade on every push.
 *
 *   • a remote NAME (`upstream`, `fork`) ⇒ `<name>/main`, and ONLY that: no
 *     cross-remote fallback, because diffing a push to `upstream` against
 *     `origin/main` measures an unrelated history. Unresolvable ⇒ the caller
 *     degrades (⇒ block for a real push), which is fail-closed and actionable
 *     (`git fetch <name>`);
 *   • no argv at all (a hand `pnpm db:migrate:check`) ⇒ `origin/main`, the
 *     project's own default branch on the project's own remote;
 *   • a URL/path in `$1` (`git push https://…`, `git push ../repo.git`) ⇒ there
 *     is no remote-tracking ref to name, so `origin/main` again.
 */
export function resolveBaseRef(remoteArg: string | null): string {
  const remote = remoteArg === null ? "" : remoteArg.trim();
  if (remote === "" || REMOTE_URL_SHAPE.test(remote)) return "origin/main";
  return `${remote}/main`;
}

/**
 * Which `.sql` paths a `git diff --name-status` output actually PUBLISHES.
 *
 * Replaces the shell-side `--diff-filter=d` flag with logic that can be tested
 * hermetically (the flag itself had zero coverage — QA's blocker on #74):
 *   • `D` (deletion) is dropped — a branch that removes `drizzle/0028_x.sql`
 *     publishes no SQL to apply, and counting the deleted path would block the
 *     deletion whenever the (gitignored) marker doesn't list that old filename;
 *   • `R`/`C` keep the DESTINATION path (the last field) — a migration
 *     republished under a new filename was never applied under that name, so it
 *     stays gated;
 *   • every other status (`A`, `M`, `T`, `U`, …) keeps its single path;
 *   • non-`.sql` paths are dropped — that also excludes the `.json` marker.
 */
export function classifyPublishedSql(nameStatusLines: readonly string[]): string[] {
  const published = new Set<string>();

  for (const line of nameStatusLines) {
    const fields = line
      .split("\t")
      .map((field) => field.trim())
      .filter((field) => field !== "");
    if (fields.length < 2) continue;

    const status = fields[0];
    const path = fields[fields.length - 1];
    if (status === undefined || path === undefined) continue;
    if (status.charAt(0).toUpperCase() === "D") continue;
    if (!path.endsWith(".sql")) continue;

    published.add(path);
  }

  return [...published].sort((a, b) => a.localeCompare(b));
}

/** Shape written by scripts/migrate.ts: sorted `.sql` filenames, no paths. */
const appliedMarkerSchema = z.array(z.string());

/** `drizzle/0028_x.sql` → `0028_x.sql`; already-bare names pass through. */
function toBasename(entry: string): string {
  const normalized = entry.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * Parse the raw contents of `drizzle/meta/_applied.json`.
 *
 * `null` (file absent/unreadable), invalid JSON, or any shape that is not an
 * array of strings ⇒ `[]` — "nothing is known to be applied". Runtime-validated
 * with zod, never cast. Entries are normalized to basenames.
 */
export function parseAppliedMarker(raw: string | null): string[] {
  if (raw === null) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }

  const parsed = appliedMarkerSchema.safeParse(decoded);
  if (!parsed.success) return [];

  return parsed.data.map(toBasename);
}

/**
 * Migrations this push publishes that the marker does not list as applied.
 *
 * Both sides are compared by basename, so a git path (`drizzle/0028_x.sql`)
 * matches a marker entry (`0028_x.sql`). Marker entries with no corresponding
 * candidate are simply ignored (a stale marker is harmless — we only subtract).
 * Result is de-duplicated and sorted; empty result ⇒ the push is allowed.
 */
export function findUnappliedMigrations(
  published: readonly string[],
  applied: readonly string[],
): string[] {
  const appliedSet = new Set(applied.map(toBasename));
  const unapplied = new Set<string>();

  for (const candidate of published) {
    const name = toBasename(candidate);
    if (name === "") continue;
    if (!appliedSet.has(name)) unapplied.add(name);
  }

  return [...unapplied].sort((a, b) => a.localeCompare(b));
}
