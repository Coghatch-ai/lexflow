# CLAUDE.md

Guidance for Claude Code working in this repo.

**Refactoring or adding features? Read [docs/conventions.md](docs/conventions.md) first** — it holds
the LOV/picklist rules (English code, pt-BR label), the no-duplication + business-rules-in-`shared/`
rules, and the step-by-step refactor playbook.

**Pushing anything under `drizzle/`? Read
[.claude/library/migration-deploy-contract.md](.claude/library/migration-deploy-contract.md) first** —
CI does NOT run migrations (manual `pnpm db:migrate` from a laptop; DB in a no-NAT VPC by design), so
merge/deploy ≠ migrated. A push-guard hook blocks agent pushes of unapplied migrations.

## Project Overview

**LexFlow** — a study platform for Brazilian legal exams (initial focus: OAB bar exam).
Converted from a bolt.new POC (originally Supabase + mock data) onto the MrHewbuc
infrastructure, following the `sharpmoney` canonical template.

**Language convention:** code is English (files, vars, schema, routes); user-facing display
text is Brazilian Portuguese (pt-BR). URLs/slugs are English kebab-case.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS 3 + Recharts + lucide-react + Clerk
- **Backend:** AWS (sa-east-1) Lambda + API Gateway (HTTP API) + tRPC 11 + Drizzle ORM +
  PostgreSQL (own `lexflow` database on the shared `mrhewbuc-rds` instance)
- **Auth:** Clerk — single-user B2C, **no organizations**. Offline JWT verification via
  `CLERK_JWT_KEY` (PEM public key). Clerk **webhook is active** (`POST /webhooks/clerk`,
  Svix-verified in `api/routes/webhook-routes.ts`): `user.created/updated/deleted` upsert the
  local `users` row so signups auto-provision. Requires the `/lexflow/api/{env}/clerk-webhook-secret`
  SSM param (`whsec_…`) + the endpoint configured in the Clerk dashboard. `pnpm db:create-user
<clerk-user-id>` remains as a manual fallback.
- **Outbound relay:** `lexflow-relay-{env}` — a **non-VPC**, channel-routed Lambda. The VPC API
  Lambda has no internet egress (no NAT), so all outbound calls go through it via an **S3 async
  job pattern**: the API writes a job to `jobs/{userId}/{jobId}.json` in the relay outbox S3 bucket
  (free S3 gateway endpoint, no NAT); an S3 ObjectCreated event triggers the relay Lambda, which
  processes the channel, writes the result to `results/{userId}/{jobId}.json`, and deletes the job;
  the API polls `getRelayJob()` (`api/lib/relay.ts`) by reading the result key until it appears
  (`status:pending`), contains a success payload (`status:done`), or contains a failure marker
  (`status:error`). Code: `api/lib/relay.ts` (enqueue + poll) → `api/relay/relay-handler.ts`
  (S3-triggered handler). Channels: `ai` (multi-provider: Gemini or OpenAI, selected by SSM
  `ai-provider`; production currently runs OpenAI — see below), `email` (SMTP scaffold). GitHub
  issues moved to the central `mrhewbuc-issues` service (browser-direct), not handled here.
  **AI provider selection** (`api/relay/relay-handler.ts`): SSM `{prefix}/ai-provider` selects
  `"gemini"` (default fallback in code) or `"openai"`. Model: `{prefix}/ai-model` (Gemini) or
  `{prefix}/openai-model` (OpenAI; code default `gpt-4o-mini`). API keys: `{prefix}/ai-api-key`
  (Gemini) or `{prefix}/openai-api-key` (OpenAI). Provider/model params are read live (uncached,
  non-secret) so they can be swapped via SSM without a redeploy. Secrets under SSM
  `/lexflow/relay/{env}/*`. See `docs/relay_lambda.md` + `docs/smtp_notification_setup.md`.
- **Package manager:** pnpm 10. **Node:** 24 (Lambda runtime + CI).

## Data model — single-user B2C (NOT multi-tenant)

There are no tenants/orgs/memberships. `users` rows are individual students (`external_id`
holds the Clerk user id). `oab_questions` is a global public catalog. Every other table is
owned by exactly one user via `user_id`. Per-user isolation is enforced by
`createScopedDb({ userId })` in `api/db/scope.ts` — add a `TABLE_SCOPE` entry whenever you add
a table to `drizzle/schema.ts`.

Procedure tiers (`api/trpc/procedures.ts`): `publicProcedure` (health, public catalog),
`verifiedProcedure` (JWT only), `protectedProcedure` (JWT + local user row, injects `ctx.db`
scoped by `userId` — the default), `adminProcedure` (`users.role === "admin"`).

## Commands

```bash
pnpm dev          # Express dev server (tRPC) on :3001
pnpm dev:app      # Vite dev server (frontend)
pnpm build        # Vite production build → dist/app/
pnpm check        # tsc (backend max-strict + frontend)
pnpm lint         # ESLint (strict, type-aware, --max-warnings 0)
pnpm test         # Vitest
pnpm validate     # check + lint + test
pnpm db:generate  # Generate migration SQL from drizzle/schema.ts (review before applying)
pnpm db:migrate   # Apply pending migrations
pnpm db:seed      # Seed the global oab_questions catalog (heavy; idempotent)
pnpm db:seed-lov  # Sync ONLY list_of_values picklists from shared/data/lov.ts (FK-free, idempotent).
                  # Use this for ANY LOV/disciplines/label change — NOT db:seed (see docs/conventions.md).
pnpm db:create-user <clerk-user-id> [email] [name...]   # Manually create a local users row
pnpm smoke        # End-to-end check of the data API against the DB (throwaway user, self-cleans)
# NOTE: no e2e/uat script yet — framework UAT (/uat) is unavailable until one is added.
```

## Data API (tRPC routers)

`questions` (list/filter, disciplines, reviewQueue), `sessions` (record session + answers in one
transaction, listRecent), `stats` (summary / byDiscipline / byExamBoard / byResponseTime /
recurringErrors, computed on read), `goals` (list/create/update/delete), `users.me`,
`ai.grade` (2ª-fase discursive grading via the relay → Gemini; `admin.questions.generateExplanation`
does 1ª-fase explanations). Most are `protectedProcedure`; `issues` (create/list/get/close GitHub
issues via the relay → GitHub) is `adminProcedure`. The relay owns the secrets; the API owns the
server-side prompts (`api/lib/ai-prompts.ts`).

The whole bolt UI is now wired onto these routers (no more mock data). Navigation uses Wouter.
Most pages pass full strict lint; `TestingPage`, `StudyPlanPage`, `AdminPage`, and the three
simulation components are still quarantined (need `max-lines-per-function` refactoring per
conventions.md playbook A/B/C before they can be un-quarantined).

## POC deviations (intentional — differ from sharpmoney; revisit as the POC matures)

1. **Tailwind 3, not 4.** The inherited bolt UI uses `@tailwind` directives +
   `tailwind.config.js` + the `lex-*` color tokens in `app/src/index.css`. Kept on 3 to
   preserve the design; convention default is Tailwind 4 via `@tailwindcss/vite`.
2. **Partial lint quarantine.** Most pages/components now pass full strict lint. Still quarantined
   (need `max-lines-per-function` refactoring): `TestingPage`, `StudyPlanPage`, `AdminPage`,
   `AdaptiveSimulation`, `SpacedRepetition`, `RealExamSimulation`, `ErrorPatternAnalysis`. New code
   (api/, drizzle/, shared/, scripts/, and all other frontend files) gets full sharpmoney strictness.
3. **Two tsconfigs.** `tsconfig.api.json` (backend, max-strict: `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`) and `tsconfig.json` (frontend, POC-strict). Split because the
   import graph forces one strictness per program; frontend files can't use backend-only types.
4. **Wouter navigation.** ~~State-based navigation~~ — `App.tsx` now uses `Router`/`Switch`/`Route`
   from wouter. Auth gating uses Clerk `<SignedIn>/<SignedOut>`.
5. The UI is fully wired to real tRPC data (mock data removed). All pages pass tsc.

## Infrastructure (be careful — shared AWS account 394559824800, region sa-east-1)

- **Database:** own DB `lexflow` + role `lexflow_user` on shared `mrhewbuc-rds`
  (`mrhewbuc-rds.ctaccs4ugjxb.sa-east-1.rds.amazonaws.com`). Never use the RDS master from the app.
- **Network:** shared VPC, SG `sg-0d065bb06c8c04a68`, subnets `subnet-0cc43286651b1e2d9`,
  `subnet-03602b4d349546b6b`, `subnet-0ffadc50f6a7a1f26`. **No NAT.**
- **Secrets:** SSM Parameter Store at `/lexflow/api/{env}/*` (API: db-_, clerk-jwt-key,
  clerk-webhook-secret) and `/lexflow/relay/{env}/_`(relay: ai-api-key, ai-model, github-token,
smtp-*) — resolved at deploy by`template.yaml`, or fetched at runtime by the relay.
- **Lambda VPC endpoint:** the VPC API Lambda invokes the relay through the shared
  `com.amazonaws.sa-east-1.lambda` interface endpoint already present in the VPC
  (`vpce-0e7bd5c5b3c6f5e84`, private DNS, same 3 subnets) — no NAT, no per-stack endpoint.
- **Stack:** `lexflow-api-prod` (now also holds `lexflow-relay-{env}` + its log group).
  Frontend bucket `lexflow-frontend-mrhewbuc` + CloudFront `E31A7ZWGZ815JT`.
- **Live (deployed):** API `https://api.probius.app` (execute-api default still resolves);
  frontend `https://my.probius.app` (CloudFront `d1qru6bxdnwd2r.cloudfront.net` still resolves).
  DNS managed in Cloudflare (CNAME, DNS-only/grey cloud).
- **Repo:** `Coghatch-ai/lexflow`; OIDC role `lexflow-github-actions-role`; PROD env secrets
  `AWS_ROLE_ARN` / `CLOUDFRONT_DISTRIBUTION_ID` / `VITE_CLERK_PUBLISHABLE_KEY` / `VITE_API_URL`.
  See `infra/deploy-runbook.md` for bootstrap + custom domain steps.
- **Deploy via GitHub Actions only** (`deploy-api.yml`, `deploy-app.yml`). NEVER `sam deploy` from a laptop.
- **Migrations:** `db:generate` → review SQL → `db:migrate`. NEVER apply SQL manually to RDS.
  CI does NOT run migrations (deploy ships code only; DB in a no-NAT VPC). Before pushing anything
  under `drizzle/`, verify every migration is applied (`pnpm db:migrate` succeeded) — merge/deploy
  ≠ migrated. A push-guard hook (`.claude/hooks/guard-migrate-push.mjs`) blocks agent pushes of
  unapplied migrations via `drizzle/meta/_applied.json`. See
  [.claude/library/migration-deploy-contract.md](.claude/library/migration-deploy-contract.md).

## GitHub — issue auto-close

GitHub only auto-closes an issue when a PR merged into the default branch (or a commit
on it) carries a **closing keyword**: `Closes #N` / `Fixes #N` / `Resolves #N`. A bare
mention like `fix ... (#6)` only _links_ the issue — it does NOT close it (this is why
#6/#7/#17/#18 stayed open despite their fixes landing). Put one keyword per issue on its
own line in the PR body / squash-merge message. Confirm with
`gh pr view <n> --json closingIssuesReferences` (empty array = nothing will auto-close).
Note: a closing keyword fires on **merge**, not on deploy. Because prod is deploy-gated,
do NOT rely on it for deploy-gated work — instead label the issue `fixed-pending-deploy`
when the fix merges. The `close-deployed-issues.yml` workflow runs after a successful
`Deploy API`/`Deploy App` on `main` and auto-closes every open `fixed-pending-deploy`
issue (dropping the `needs-deploy`/`fixed-pending-deploy` labels, posting a pt-BR comment).
So: keyword = closes on merge (use for non-gated docs/chore); `fixed-pending-deploy` label
= closes on deploy (use for anything that must be live first).

**Definition of done for any pipeline fix (`/implement`):** the fix is NOT handed back until
the issue is labeled `fixed-pending-deploy` (deploy-gated work) OR the closing commit/PR
carries a `Closes #N` line (non-gated work). An implemented issue left on `solution-ready`
with no close mechanism will silently never close — this is what happened to #22/#24. Verify
with `gh issue view <n> --json labels` before reporting the issue done.

## Business rules / product facts

Authoritative product intent every agent must honor (analyst, builder, tester read this as
the contract). Add durable, standing facts here — not slice-specific notes.

- `oab_questions.{discipline,exam_board,difficulty,phase}` MUST store the English LOV code,
  never the pt-BR label. Any importer (`scripts/seed-from-csv.ts`, `scripts/seed.ts`) MUST
  map label→code before insert and throw on an unmapped label — never write a raw scraper
  label. (History: the CSV seed wrote raw pt-BR discipline labels → the code-keyed filter
  matched 0 rows; issue #46.)

## NEVER

- Bypass `createScopedDb` for user-owned tables, or add a table without a `TABLE_SCOPE` entry.
- Import `@clerk/*` outside `app/src/auth/**` or `api/lib/auth-provider/**` (the auth adapter).
- Commit `.env` or secrets (SSM for backend, GitHub Environment secrets for frontend).
- Deploy manually or run `db:push`.
- Push a new/edited `drizzle/*.sql` before it is applied (`pnpm db:migrate` succeeded) — merge/deploy
  does NOT migrate (CI ships code only; DB in a no-NAT VPC). The push-guard hook enforces this for
  agent pushes; the `needs-migration` label is only a soft reminder.
- Use `console.log` (only `warn`/`error`), `any`, or non-null `!`.
- Create a git branch without user approval.
- Add or remove a dependency (`pnpm add`/`remove`/`install <pkg>`) without explicit approval —
  tests use the existing plain-vitest setup (no jsdom, no React Testing Library). A dirtied
  `pnpm-lock.yaml` with a clean `package.json` means restore it: `git restore pnpm-lock.yaml`.
