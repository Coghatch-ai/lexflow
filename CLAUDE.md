# CLAUDE.md

Guidance for Claude Code working in this repo.

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
- **Package manager:** pnpm 10. **Node:** 22 (local + CI).

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

`questions` (list/filter the catalog, disciplines), `sessions` (record a completed session +
its answers in one transaction, listRecent), `stats` (summary / byDiscipline / byExamBoard,
computed on read), `users.me`. All are `protectedProcedure` (require a local users row). The
inherited bolt UI still renders on mock data — wiring it onto these routers is the next chunk.

## POC deviations (intentional — differ from sharpmoney; revisit as the POC matures)

1. **Tailwind 3, not 4.** The inherited bolt UI uses `@tailwind` directives +
   `tailwind.config.js` + the `lex-*` color tokens in `app/src/index.css`. Kept on 3 to
   preserve the design; convention default is Tailwind 4 via `@tailwindcss/vite`.
2. **Vendored bolt UI is quarantined from strict lint/tsc.** `app/src/pages/**`,
   `app/src/components/**`, and `app/src/lib/mockData.ts` are ESLint-ignored and type-checked
   at POC strictness. New code (api/, drizzle/, shared/, scripts/, and the authored frontend
   wiring under `app/src/auth`, `app/src/shared`, `app/src/providers`, `main.tsx`, `App.tsx`)
   gets full sharpmoney strictness. Harden each page when it migrates off mock data onto tRPC.
3. **Two tsconfigs.** `tsconfig.api.json` (backend, max-strict: `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`) and `tsconfig.json` (frontend, POC-strict). Split because the
   bolt UI can't pass max-strict yet and the import graph forces one strictness per program.
4. **State-based navigation, not Wouter.** `App.tsx` switches pages via local state (as the POC
   did). Auth gating uses Clerk `<SignedIn>/<SignedOut>`. Convention default is Wouter.
5. The UI still renders on **mock data** (`app/src/lib/mockData.ts`). Real tRPC wiring lands in
   a later chunk.

## Infrastructure (be careful — shared AWS account 394559824800, region sa-east-1)

- **Database:** own DB `lexflow` + role `lexflow_user` on shared `mrhewbuc-rds`
  (`mrhewbuc-rds.ctaccs4ugjxb.sa-east-1.rds.amazonaws.com`). Never use the RDS master from the app.
- **Network:** shared VPC, SG `sg-0d065bb06c8c04a68`, subnets `subnet-0cc43286651b1e2d9`,
  `subnet-03602b4d349546b6b`, `subnet-0ffadc50f6a7a1f26`. **No NAT.**
- **Secrets:** SSM Parameter Store at `/lexflow/api/{env}/*` (resolved at deploy by `template.yaml`).
- **Stack:** `lexflow-api-prod`. Frontend bucket `lexflow-frontend` + CloudFront (no custom domain yet).
- **Deploy via GitHub Actions only** (`deploy-api.yml`, `deploy-app.yml`). NEVER `sam deploy` from a laptop.
- **Migrations:** `db:generate` → review SQL → `db:migrate`. NEVER apply SQL manually to RDS.

## NEVER

- Bypass `createScopedDb` for user-owned tables, or add a table without a `TABLE_SCOPE` entry.
- Import `@clerk/*` outside `app/src/auth/**` or `api/lib/auth-provider/**` (the auth adapter).
- Commit `.env` or secrets (SSM for backend, GitHub Environment secrets for frontend).
- Deploy manually or run `db:push`.
- Use `console.log` (only `warn`/`error`), `any`, or non-null `!`.
