# Migration ↔ deploy contract

The standing rule for how Drizzle migrations reach the database, and why a `git push` is
NOT enough to ship a schema change. Read this before recommending or running any push that
touches `drizzle/`.

## CI does not run migrations

The deploy pipeline (`deploy-api.yml` / `deploy-app.yml`) ships **code only**. Nothing in CI
runs `db:migrate`. Migrations are applied **manually** with `pnpm db:migrate` from a laptop
that can reach the DB.

Why manual and not in CI: the `lexflow` database lives in a **no-NAT VPC by design** (the API
Lambda has no internet egress). CI runners cannot reach RDS. So the migration step is human,
deliberate, and out-of-band from deploy — this is intentional, not a gap to "fix" by adding a
CI migrate step.

Consequence: pushing a new `drizzle/*.sql` merely ships the schema _intent_ in git and deploys
the _code_ that expects the new schema. If the migration was never applied, the deployed code
runs against an old schema → runtime failures. **Merge/deploy ≠ migrated.**

## Always verify pending migrations before a push

Before recommending or running a push that adds/edits `drizzle/*.sql`:

1. Confirm every migration on disk was applied locally (`pnpm db:migrate` succeeded).
2. Only then push.

This is enforced deterministically at **`pre-push`**, for **every** push of **every ref** — the
human's own terminal `git push` included (issue #74; the previous agent-only Claude Code hook
`.claude/hooks/guard-migrate-push.mjs` is **retired and deleted**). "Every push of every ref" is
literal and was twice not true: the gate first measured `origin/main...HEAD`, so any push of a ref
other than the checked-out branch slipped through (third bypass), and it then silently measured the
WORKTREE whenever the diff was impossible, so a clone whose remote is not named `origin` passed
everything (fourth bypass). A third hole of the same class — a WORKING diff over a lost/garbled ref
feed silently measured `HEAD` (fifth residue) — was closed in review round 5. All three are closed:
a push is now either measured or blocked, never approximated. Round 6 refined the round-5 rule for
the one feed class where blocking was wrong: an EMPTY feed (what an already-up-to-date push
produces) is measured against `HEAD` and judged on the result instead of blocked outright — see
"What the push publishes" and "Which universe is measured" below:

- `.husky/pre-push` is a single `&&` chain, gate FIRST — the migration check runs before
  `pnpm validate`, and a failing check short-circuits (validate never runs, hook exits non-zero):

  ```sh
  pnpm db:migrate:check "$@" && pnpm validate
  ```

  `"$@"` is load-bearing too: git invokes `pre-push` with `<remote-name> <remote-url>`, and the
  gate compares against **that remote's** `main` (`resolveBaseRef`) instead of a hardcoded
  `origin/main` — the fix for the fourth bypass below. `pnpm` forwards the extra args to the
  script (verified: `sh -e <hook> upstream <url>` ⇒ `tsx scripts/check-migrations.ts upstream <url>`).

  The `&&` is load-bearing and must not be split back into two lines. Husky's own runner
  (`.husky/_/h`) happens to invoke the hook as `sh -e "$s"`, which would also abort on line 1 —
  but the hook file must not depend on the caller's flags: run as two bare lines under a plain
  `sh`/`bash`/`zsh`, the exit status is the LAST line's, so a failing migration check plus a
  passing `validate` would exit 0 and let the push through (verified: `sh` two-line body ⇒
  `exit=0`, `validate` RAN; `&&` body ⇒ `exit=1`, `validate` NOT run).

  The hook must also **forward its stdin** to the check (a bare `pnpm db:migrate:check` does:
  verified in a scratch repo — the gate received the ref line through `pnpm` and blocked, and the
  second link of the `&&` never ran).

- `pnpm db:migrate:check` → `scripts/check-migrations.ts` — the impure shell (git + fs + stdin +
  exit code). All decision logic is pure in `scripts/lib/migration-guard.ts`
  (`parseAppliedMarker`, `findUnappliedMigrations`, `resolveDiffTips`, `classifyPublishedSql`,
  `classifyPushFeed`, `planMeasurement`, `emptyFeedBlockReason`, `resolveBaseRef`), unit-tested
  hermetically in `scripts/lib/migration-guard.test.ts` (60 cases).
  The shell resolves every path from `git rev-parse --show-toplevel`, not the cwd, so
  `pnpm db:migrate:check` from a subdirectory checks the same thing it does from the root.
- `scripts/migrate.ts` — on a SUCCESSFUL migrate, atomically writes `drizzle/meta/_applied.json`
  (sorted applied `.sql` filenames; temp-file + rename so a partial migrate can't leave a false
  marker).
- `drizzle/meta/_applied.json` is **gitignored** — per-machine local state, never committed.

### "Unapplied" = what THIS push publishes

**What the push publishes comes from the hook's STDIN, not from `HEAD`.** git feeds `pre-push` one
line per ref: `<localref> <localsha> <remoteref> <remotesha>`. `resolveDiffTips()` turns that into
the list of tips to diff:

| stdin                                      | tips                | why                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent / blank (manual `db:migrate:check`) | `["HEAD"]`          | a hand run has no stdin and must still check something. On a REAL push those two split: `absent` ⇒ block, `blank/empty` ⇒ `HEAD` is MEASURED and the verdict follows the measurement (round 6, below) |
| one or more ref lines                      | each `<localsha>`   | covers `push origin br:br`, `push --all`, `push.default=matching`                                                                                                                                     |
| `<localsha>` all zeros                     | that ref is skipped | the ref is being DELETED — it publishes no SQL                                                                                                                                                        |
| every line a deletion                      | `[]`                | the push publishes nothing ⇒ pass                                                                                                                                                                     |
| any unparseable line                       | `["HEAD"]`          | never conclude "nothing is pushed" from a garbled feed — and `["HEAD"]` is then only a HAND-RUN universe: on a real push `planMeasurement` BLOCKS instead of measuring it (see below)                 |

This replaced a fixed `origin/main...HEAD`, which was the **third bypass** found on #74: with `main`
checked out, `git push origin mig:mig` (and `git push --all`) diffed a commit the push wasn't
publishing, saw zero candidates, and let unapplied SQL out. Reproduced in a throwaway repo — gate
`exit 0`, `drizzle/0001_evil.sql` landed on the remote — and blocked (`exit 1`, ref not created)
after the fix.

For each tip the candidate set is `git diff --name-status <remote>/main...<tip> -- drizzle`
(`<remote>` from `resolveBaseRef`, see below — `origin/main` only on a hand run; three dots ⇒
compared against the merge-base, not the tip of `main`), classified by the pure
`classifyPublishedSql()` and unioned — **not** every `.sql` on disk. Classification, formerly the
untested `--diff-filter=d` flag: status `D` is dropped (a branch that DELETES a migration publishes
no SQL to apply, and counting the deleted path would block the deletion whenever the gitignored
marker doesn't happen to list that old filename); `R`/`C` keep the **destination** path (a
migration republished under a new filename was never applied under that name, so it stays gated);
every other status keeps its path; non-`.sql` is dropped.

Scoping to the push (rather than to the disk) is deliberate: the marker is gitignored, so the naive
"disk × marker" rule would make a fresh clone treat all 28 existing migrations as pending and block
even a docs-only push; a gate that fires on unrelated pushes gets `MIGRATE_GUARD_SKIP=1` parked in a
`.zshrc`, and then it protects nothing.

Decision matrix:

| Situation                                              | Verdict                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| push publishes no `drizzle/*.sql`                      | **pass**, silently — the marker is not even read                                                   |
| push only DELETES refs (all-zero local sha)            | **pass** — no tip to diff; nothing published                                                       |
| push only DELETES `drizzle/*.sql` (status `D`)         | **pass** — `classifyPublishedSql` drops it; no SQL to apply                                        |
| published `.sql` present in the marker                 | **pass**                                                                                           |
| published `.sql` + marker missing/invalid/wrong shape  | **block — fail closed**, names the files, in pt-BR                                                 |
| `git` / `<remote>/main` unavailable **on a real push** | **block — fail closed**, saying why. The worktree is NOT substituted                               |
| same, on a **hand run** (`db:migrate:check`, no stdin) | conservative pass/fail over every `drizzle/**/*.sql` on disk, **announced** (`⚠ MODO CONSERVADOR`) |
| `drizzle/` itself unreadable (cannot even enumerate)   | **block — fail closed**, loudly, saying why                                                        |
| run from a subdirectory                                | same verdict as from the root (paths resolve from the toplevel)                                    |
| marker lists files that no longer exist                | harmless — the gate only subtracts                                                                 |

### Which universe is measured (the fourth bypass, closed)

The base ref is `<remote>/main`, where `<remote>` is the remote NAME git passes `pre-push` as `$1`
(`resolveBaseRef`); a hand run with no argv uses `origin/main`; a URL/path in `$1`
(`git push https://…`) also falls back to `origin/main`. A named remote gets **no** cross-remote
fallback — diffing a push to `upstream` against `origin/main` would measure an unrelated history.

When the diff is impossible (base ref unresolvable, `git diff` fails, no repo root), the choice of
what to measure is pure (`planMeasurement`) and it is **not** "measure the worktree":

| situation                                                          | universe                                                                                                      | why                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| real push (argv present) **and** the ref feed is ABSENT or GARBLED | **none ⇒ block**, whatever the diff did                                                                       | the chain is broken; the only remaining universe would be `HEAD`, which does not answer for the pushed ref                               |
| real push **and** the ref feed is EMPTY, diff worked               | `HEAD` vs `<remote>/main`, **measured**, then decided: clean ⇒ pass (announced), unapplied `.sql` ⇒ **block** | an empty feed is what an already-up-to-date push produces; the gate concludes nothing from it and judges by what it can actually measure |
| real push **and** the ref feed is EMPTY, diff impossible           | **none ⇒ block**                                                                                              | the fallback measurement itself failed — nothing was measured                                                                            |
| diff worked **and** git fed us a ref list                          | the pushed tips                                                                                               | what the push publishes                                                                                                                  |
| diff impossible **and** git fed us a ref list                      | **none ⇒ block**                                                                                              | "don't know what this push publishes" ≠ "it publishes nothing"                                                                           |
| diff impossible **and** no stdin (hand run)                        | every `.sql` on disk, announced                                                                               | there is no push to measure; the disk is the only universe                                                                               |
| hand run (no argv) **and** diff worked                             | `HEAD`                                                                                                        | no push exists; `HEAD` is the meaningful universe of a hand run                                                                          |

The first row is the **fifth residue** (#74 review round 5), same class as the third and fourth
bypasses — the gate measured the wrong commits. `planMeasurement` used to return `{kind:"push"}` on
ANY successful diff without ever asking whether `tips` came from the feed or from the `["HEAD"]`
fallback, so a real push with a lost/garbled feed measured `HEAD` and exited 0 with **zero output**
while the pushed tip carried unapplied SQL. Measured before the fix: empty stdin + push argv ⇒
`exit 0`; a 5-field feed line + push argv ⇒ `exit 0`; the same push with a correct 4-field feed ⇒
`exit 1`. The discriminator is argv: git ALWAYS invokes `pre-push` with `<remote-name> <remote-url>`
(`NARG=2`), a hand `pnpm db:migrate:check` has `argv[2] === undefined`. Guarded by
`classifyPushFeed` (`fed` / `empty` / `garbled` / `absent`) plus cases `(al)`–`(as)` and `(ak2)`.

**Round 6 split that row by feed class.** Round 5 blocked all three non-`fed` classes, which was
right for `absent`/`garbled` (a broken chain) and wrong for `empty`: git starts `pre-push` BEFORE
filtering refs that are already up to date, so an ordinary `git push` with nothing new to publish
arrives as zero bytes on fd 0 and was being blocked. A gate that fails the most routine push in the
world gets `MIGRATE_GUARD_SKIP=1` parked in a `.zshrc`, and then it protects nothing — the same
failure mode that made the candidate set push-scoped in the first place. Neither obvious
alternative is right on its own: passing on `empty` restores the fail-open hole, and an `fstat`
pipe-vs-`/dev/null` check still cannot tell a legitimately empty pipe from a wrapper that hands us
an empty one. So the gate **concludes nothing from an empty feed and measures instead**
(`planMeasurement` ⇒ `{kind:"head-fallback"}`): it diffs `HEAD` against the same
`resolveBaseRef(remoteArg)` base the fed path uses, and passes ONLY when that diff publishes no
unapplied `.sql`; an unapplied migration blocks (the message names that the feed was unreadable and
that `HEAD` was measured against the base), and a diff that itself fails blocks, as everywhere else
the gate cannot measure. `absent`/`garbled` still block unchanged, the hand run keeps its announced
conservative path, and no previously-blocking path was weakened. The pass is announced
(`⚠ Gate de migração: feed de refs vazio — medi HEAD em vez do ref empurrado`), never silent.
Guarded by cases `(al)`, `(ao2)`, `(ao3)`, `(at)`–`(ay)`. The residue this leaves is in
`### Limits (honest)` below: it measures `HEAD`, not the pushed tip.

This was the **fourth bypass** on #74 (same class as the third — the gate looked at the wrong
commits). The shell used to degrade to `allSqlOnDisk(root)` on ANY failure, silently swapping the
push for the worktree. In a clone whose remote is not named `origin` (a fork, `git remote rename`,
`clone --single-branch --branch <not-main>`) `origin/main` never resolves, so **every** push
degraded; with the worktree fully applied the candidate set was empty ⇒ `exit 0` with **zero
output**, publishing unapplied SQL. Reproduced end to end in a throwaway clone whose only remote is
`upstream` (worktree fully applied, pushed tip carrying an unapplied `0002_new.sql`): pre-fix gate
⇒ `exit 0`, no output, `migA2` created on the remote; fixed gate ⇒ `✗ Push bloqueado … •
0002_new.sql`, `exit 1`, ref never created; with `upstream/main` deleted (never fetched) ⇒
`✗ Push bloqueado: não foi possível determinar o que este push publica`, `exit 1`, ref never
created. A hand run (`pnpm db:migrate:check`, no stdin, worktree fully applied) still exits 0.

A PASS that did not measure the pushed tips is never silent. The hand-run conservative pass prints
`⚠ Gate de migração em MODO CONSERVADOR`, the reason, the universe it measured, and that the same
reason BLOCKS on a real push; the empty-feed pass prints `⚠ Gate de migração: feed de refs vazio —
medi HEAD em vez do ref empurrado`, the reason, and how many `.sql` it checked. Silence was what
made the fourth bypass invisible.

Fail-closed is the right posture here, unlike the old hook (which failed open because it ran on
**every** Bash command and its own bug would have wedged the agent). This gate runs only on push
and only when there is a candidate — and failing closed is exactly the epic #50 near-miss below.

### Limits (honest)

- **CI is NOT covered and cannot be.** `pre-push` is local (husky). CI has no marker (gitignored)
  and cannot reach RDS (no-NAT VPC, top of this doc) — no CI gate can know what was applied.
  **Merge/deploy ≠ migrated** stays a human contract.
- **Not folded into `pnpm validate`** on purpose: `validate` runs in CI, where the marker never
  exists ⇒ every PR carrying a migration would go red on an unsatisfiable condition, and
  `pnpm test` would stop being hermetic (tied to the machine's migration state).
- **The gate compares FILENAMES, never contents — an EDITED already-applied `.sql` passes.** The
  marker records the `.sql` filenames present after a successful `pnpm db:migrate`; nothing hashes
  the SQL. So re-editing `drizzle/0026_x.sql` after it was applied publishes a file whose name is
  already in the marker ⇒ silent pass, exactly the case where the DB diverges from the published
  SQL. **Decision (#74 review round): fix the CLAIM, not the gate.** Closing it for real means
  storing a per-file hash in the marker and teaching `scripts/migrate.ts` to write it — a new
  marker schema plus a migration path for every existing marker, which is a separate slice, not a
  wording fix. It also would not change the outcome that matters: drizzle tracks applied
  migrations by journal entry and will **never re-run** an edited `.sql` regardless of this gate,
  so the correct action was always "add a NEW migration", a human rule. `CLAUDE.md`'s NEVER entry
  now says so explicitly instead of implying the gate covers it.
- **Escapes still exist:** `MIGRATE_GUARD_SKIP=1`, `git push --no-verify`, `HUSKY=0`. The gate
  raises the floor (it now catches the human's manual push, and any ref that push publishes —
  which neither the old hook nor the first version of this gate did); it does not make the
  mistake impossible. `MIGRATE_GUARD_SKIP=1` is no longer SILENT, though: it prints
  `⚠ Gate de migração DESLIGADO por MIGRATE_GUARD_SKIP=1` before returning. It used to exit 0 with
  zero bytes, so an exported variable — `.husky/_/h` sources
  `${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh` on every hook — would have disabled the gate
  forever without ever saying so (`--no-verify` at least shows up on the command line).
- **A BROKEN ref feed (absent/garbled) BLOCKS a real push** — the fifth residue, closed by failing
  closed: the fallback universe (`HEAD`) does not answer for the pushed ref, and a feed that arrived
  unreadable means some wrapper in the chain (`git` → `.husky/_/h` → `pre-push` → `pnpm` → `tsx`)
  mangled it.
- **An EMPTY ref feed is MEASURED against `HEAD`, and that measurement is not the pushed tip.**
  (Round 6; the honest residue of the fix described above.) An empty feed is ambiguous by
  construction — an already-up-to-date push and a swallowed feed both arrive as zero bytes on fd 0,
  and no `fstat` pipe-vs-`/dev/null` check separates them either. Rather than assume, the gate
  diffs `HEAD` against `<remote>/main` and decides on the result. **The residue: it judges `HEAD`,
  not the pushed ref.** A push of some OTHER ref (`git push origin mig:mig` from a checked-out
  `main`) that arrived with an EMPTY feed would be judged by `HEAD`'s contents — so an unapplied
  `.sql` living only on `mig` would not be seen, while `HEAD`'s own unapplied `.sql` would block a
  push that does not publish it. Both halves are strictly better than the fail-open this replaced
  and than round 5's false positive on every routine push, but neither is exact. In practice the
  combination is not reachable through plain `git`: a push that really publishes a ref feeds that
  ref on stdin (`fed`), and this path only runs when the feed is empty — i.e. when git believes
  there is nothing to publish. It becomes reachable only if a wrapper swallows a NON-empty feed and
  hands the gate zero bytes, which is exactly the case that cannot be told apart from the routine
  one. Closing it for real needs the pushed refs from a source other than stdin (there is none —
  `pre-push` has no argv for them), so it is documented, not fixed.
- **Stdin is read only when fd 0 is not a TTY.** A hand-run `pnpm db:migrate:check` in a terminal
  reports "no stdin" and falls back to `HEAD` (correct). A non-interactive caller that inherits an
  stdin which never reaches EOF would block on the read — no such caller exists today
  (`pnpm validate` does not invoke this gate), but that is the shape of the failure if one appears.
- **The degraded-worktree bypass is CLOSED, not a limit any more** (fourth bypass, #74 review round
  4), and so is the lost-feed one (fifth residue, round 5): a push whose diff is impossible — or
  whose ref feed arrived absent/garbled — is BLOCKED instead of silently re-measured against the
  worktree or against `HEAD`, and every pass that did not measure the pushed tips announces itself
  (the hand-run conservative mode, and the round-6 empty-feed `HEAD` measurement). Both are listed
  here only so the next reader does not have to rediscover them: the honest residue is the bullets
  above and below.
- **The base BRANCH is hardcoded `main`.** `resolveBaseRef` builds `<remote>/main`. A repo whose
  default branch is not `main`, or a remote whose `main` is not the integration branch, degrades ⇒
  block on a real push (fail-closed, actionable: `git fetch <remote>`), never a silent pass. Not
  worth a `remote HEAD` lookup while lexflow's default branch is `main`.
- **A hand `pnpm db:migrate:check` is NOT a push verification.** With no stdin there is no push, so
  it measures the disk against the marker. It answers "is my worktree applied?", not "is this push
  safe?" — and says so in its own output when it runs degraded.
- **A LINKED WORKTREE can block on a migration that IS applied.** `drizzle/meta/_applied.json` is
  gitignored and lives per worktree, so `git worktree add ../wt-x` starts with no marker: a push
  from there that publishes any `.sql` sees "nothing known applied" and blocks (fail-closed,
  measured). Correct direction, false positive in a flow the pipeline itself recommends. Workaround
  is a `pnpm db:migrate` (idempotent) in the worktree, or pushing from the main checkout — not a
  parked `MIGRATE_GUARD_SKIP=1`, which disables the gate everywhere.
- **The marker is derived from disk, not from the DB.** `scripts/migrate.ts` records _every_
  `.sql` in the directory after a successful migrate, so a `.sql` dropped in by hand outside
  `drizzle/meta/_journal.json` would be marked applied without `migrate()` touching it. No
  divergence today; the gate inherits the limit (separate issue, not fixed here).

### Branch creation: retired with no replacement

`.claude/hooks/guard-branch-create.mjs` was deleted and gets **no** substitute. Branch creation
is decided by session policy (the agent asks the owner), not by a repo hook. `.claude/settings.json`
carries only `skillOverrides` now — do not reintroduce a `hooks` block for either guard.

The `needs-migration` issue label remains a **soft convention** (a human reminder). The `pre-push`
gate **supersedes it** as the real guard — the label can be forgotten; the marker cannot.

## Near-miss history (why this exists)

Epic #50 (D1/D4 credit engine) shipped migrations `0025` / `0026` (a `DROP TABLE`) / `0027`
**unapplied** — the code merged and would have deployed ahead of the schema. Caught only by the
**human** at push time, not by any gate. That is precisely the failure the marker + hook now
prevent deterministically.

## Learning-loop habit

A near-miss caught by the **human** — where the safety came from the person, not the pipeline —
is **debrief-worthy, not a terminal success**. The right response to "the human caught it" is to
root-cause why no gate caught it and to close that gap (as was done here), not to move on because
nothing actually broke.
