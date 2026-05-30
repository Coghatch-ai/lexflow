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

The UI currently renders on mock data; real tRPC data wiring is in progress.
