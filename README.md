# LexFlow

Study platform for Brazilian legal exams (initial focus: the OAB bar exam).

Converted from a bolt.new POC onto MrHewbuc infrastructure: React + Vite + Tailwind frontend,
AWS Lambda + API Gateway + tRPC + Drizzle backend on PostgreSQL (own `lexflow` database on the
shared `mrhewbuc-rds` instance), Clerk auth (single-user B2C).

See [CLAUDE.md](./CLAUDE.md) for architecture, conventions, and the AWS infrastructure notes.

## Local development

```bash
pnpm install
cp .env.example .env   # fill in DB_* + Clerk keys
pnpm dev               # API dev server (tRPC) on :3001
pnpm dev:app           # Vite frontend
```

The UI is fully wired to real tRPC data. All 8 pages (home, testing, analytics, goals, study
plans, profile, saved questions, admin) call live backend routers — no mock data remains.

**Live:** frontend at `https://my.probius.app`, API at `https://api.probius.app`.

New users must be created manually until Clerk webhook is configured:

```bash
pnpm db:create-user <clerk-user-id> [email] [name]
pnpm db:make-admin <clerk-user-id>   # for admin access
```
