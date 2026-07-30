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

This is now enforced deterministically for **agent** pushes:

- `.claude/hooks/guard-migrate-push.mjs` — PreToolUse(Bash) hook. Blocks an agent `git push`
  when a `drizzle/*.sql` file on disk is absent from the apply-time marker
  `drizzle/meta/_applied.json`. Names the unapplied file(s). Escape hatch:
  `MIGRATE_GUARD_SKIP=1`. Fail-open on the guard's own errors. Gates agent (Bash-tool) pushes
  only — the human's own terminal `git push` is untouched (it is a Claude Code hook, not a
  `.git/hooks`/husky hook, on purpose).
- `scripts/migrate.ts` — on a SUCCESSFUL migrate, atomically writes `drizzle/meta/_applied.json`
  (sorted applied `.sql` filenames; temp-file + rename so a partial migrate can't leave a false
  marker).
- `drizzle/meta/_applied.json` is **gitignored** — per-machine local state, never committed.
- Chained after the existing gates in `.claude/settings.json` (after `guard-branch-create.mjs`).

The `needs-migration` issue label remains a **soft convention** (a human reminder). The hook
**supersedes it** as the real guard — the label can be forgotten; the marker cannot.

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
