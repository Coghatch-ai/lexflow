# CLAUDE.md

Guidance for Claude Code working in this repo.

**Refactoring or adding features? Read [docs/conventions.md](docs/conventions.md) first** — it holds
the LOV/picklist rules (English code, pt-BR label), the no-duplication + business-rules-in-`shared/`
rules, and the step-by-step refactor playbook.

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
  `CLERK_JWT_KEY` (PEM public key). **POC: no webhook** — local `users` rows are created
  manually with `pnpm db:create-user <clerk-user-id>` (the `webhook-routes.ts` path exists but
  is inert until a Clerk webhook + `clerk-webhook-secret` SSM param are configured).
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
pnpm db:seed      # Seed the global oab_questions catalog (idempotent)
pnpm db:create-user <clerk-user-id> [email] [name...]   # Manually create a local users row
pnpm smoke        # End-to-end check of the data API against the DB (throwaway user, self-cleans)
```

## Data API (tRPC routers)

`questions` (list/filter, disciplines, reviewQueue), `sessions` (record session + answers in one
transaction, listRecent), `stats` (summary / byDiscipline / byExamBoard / byResponseTime /
recurringErrors, computed on read), `goals` (list/create/update/delete), `users.me`. All are
`protectedProcedure` (require a local users row).

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
- **Secrets:** SSM Parameter Store at `/lexflow/api/{env}/*` (resolved at deploy by `template.yaml`).
- **Stack:** `lexflow-api-prod`. Frontend bucket `lexflow-frontend-mrhewbuc` + CloudFront `E31A7ZWGZ815JT`.
- **Live (deployed):** API `https://api.probius.app` (execute-api default still resolves);
  frontend `https://my.probius.app` (CloudFront `d1qru6bxdnwd2r.cloudfront.net` still resolves).
  DNS managed in Cloudflare (CNAME, DNS-only/grey cloud).
- **Repo:** `Coghatch-ai/lexflow`; OIDC role `lexflow-github-actions-role`; PROD env secrets
  `AWS_ROLE_ARN` / `CLOUDFRONT_DISTRIBUTION_ID` / `VITE_CLERK_PUBLISHABLE_KEY` / `VITE_API_URL`.
  See `infra/deploy-runbook.md` for bootstrap + custom domain steps.
- **Deploy via GitHub Actions only** (`deploy-api.yml`, `deploy-app.yml`). NEVER `sam deploy` from a laptop.
- **Migrations:** `db:generate` → review SQL → `db:migrate`. NEVER apply SQL manually to RDS.

## NEVER

- Bypass `createScopedDb` for user-owned tables, or add a table without a `TABLE_SCOPE` entry.
- Import `@clerk/*` outside `app/src/auth/**` or `api/lib/auth-provider/**` (the auth adapter).
- Commit `.env` or secrets (SSM for backend, GitHub Environment secrets for frontend).
- Deploy manually or run `db:push`.
- Use `console.log` (only `warn`/`error`), `any`, or non-null `!`.
