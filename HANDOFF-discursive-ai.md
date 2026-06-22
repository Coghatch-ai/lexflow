# Handoff — OAB 2ª-fase (discursive) feature + AI grading

Status: feature code complete and passing `check`/`lint`/`test`. **Nothing committed,
pushed, or deployed.** There is **one unresolved objection from the user** about RDS
usage (see "OPEN ISSUE" — resolve this first).

---

## Goal

Add OAB "2ª fase" (discursive / prático-profissional) support to LexFlow/Probius:
read a long question, write a free-text answer, reveal the official padrão, self-score,
and optionally get an AI grade. Filters by area / exam / type. Two practice units:
single-question and full-prova (1 peça + 4 discursivas, /10).

---

## OPEN ISSUE (must resolve before continuing)

The user said: **"this is wrong, you cannot save rds"** and ended the session before
clarifying. They did not say which RDS use is wrong. AI grading currently touches RDS
in three places, all via the lexflow API Lambda (which CAN reach RDS online — it's in
the VPC; the central relay is non-VPC and never touches RDS):

1. **`app_config` table** — stores the editable grading prompt (`discursive.gradingPrompt`
   read, `setGradingPrompt` write). This is the new table added this session.
2. **`saveAiGrade`** — writes `ai_score`/`ai_feedback`/`ai_graded_at` onto the answer row.
3. The discursive answer/session tables themselves (`user_discursive_answers`,
   `discursive_sessions`).

Most likely the objection is #1 (don't store the prompt in RDS). The straightforward fix:
drop `app_config`, keep the prompt as the code default in `shared/domain/ai-eval.ts`
(edit = a frontend change), or move it to SSM/the relay if it must be tunable without a
deploy. **Confirm with the user which RDS use is wrong before changing anything** — the
discursive tables are load-bearing for the whole feature.

---

## Architecture

- **Self-evaluation works with no LLM at all** (the core feature). AI grading is additive.
- **AI grading has two paths (hybrid in `DiscursiveRunner.tsx`, chosen at runtime):**
  - **Online (deployed)** → the deployed lexflow Lambda has **no NAT / no internet**, so
    grading goes **browser → central `mrhewbuc-issues` relay (task=complete) → Gemini**.
    Active when `VITE_AI_SERVICE_URL` is set.
  - **Local dev** → backend-direct: tRPC `discursive.gradeWithAi` → `api/lib/ai-provider.ts`
    → Gemini, using the key in `api/.env`. Active when `VITE_AI_SERVICE_URL` is unset.
- **Provider = Google Gemini** (the user has no Anthropic key; they want free/cheap).
  Provider-agnostic: the relay and `ai-provider.ts` support Gemini natively and any
  OpenAI-compatible endpoint (OpenAI, Groq via base URL).
- **The grading prompt + reply parsing live in lexflow** (`shared/domain/ai-eval.ts`),
  not in the relay (the relay is a thin, generic LLM proxy). The prompt is currently
  stored in the `app_config` RDS row with a code default fallback — **this is the disputed
  part (see OPEN ISSUE).**

---

## What was done

### Lexflow (`/Users/arthurnunes/Library/MRHEWBUC-LOCAL/lexflow`, branch `main`, all UNCOMMITTED)

Schema / data:

- `drizzle/schema.ts` — added tables `discursiveSessions`, `userDiscursiveAnswers`
  (real scores; nullable `ai_score`/`ai_feedback`/`ai_graded_at`), and `appConfig` (key/value).
- `api/db/scope.ts` — `TABLE_SCOPE`: `discursive_sessions`/`user_discursive_answers` = user;
  `app_config` = global.
- Migrations generated **and applied to RDS**: `drizzle/0009_*.sql` (discursive tables),
  `drizzle/0010_*.sql` (`app_config`). Applied via `pnpm db:migrate` (confirmed tables live).

Backend (tRPC):

- `api/trpc/routers/discursive.router.ts` (new) — `list`, `exams`, `getProva`, `answerKey`,
  `recordAnswer`, `recordProva` (txn), `saveAiGrade`, `gradingPrompt`, `setGradingPrompt`
  (admin), `aiAvailable`, `gradeWithAi`, `listAttempts`, `recentSessions`, `stats`.
- `api/trpc/router.ts` — registered as `discursive`.
- `api/lib/ai-provider.ts` (new) — backend-direct LLM call (Gemini + OpenAI-compatible),
  reads `AI_PROVIDER`/`AI_MODEL`/`AI_API_KEY`/`AI_BASE_URL` from env. LOCAL-DEV ONLY (no NAT
  in prod).
- `api/dev-server.ts` — now loads `api/.env` after the root `.env`.

Shared domain:

- `shared/domain/discursive-attempt.ts` (+`.test.ts`) — `clampScore`, `sumScores`,
  `isProvaPass`, `PASS_THRESHOLD=6.0`, `PROVA_MAX_POINTS=10`.
- `shared/domain/ai-eval.ts` (+`.test.ts`) — `DEFAULT_GRADE_SYSTEM_PROMPT`,
  `GRADE_PROMPT_KEY`, `buildGradeUserMessage`, `parseGradeResponse`, relay schemas.

Frontend (`app/src`):

- `pages/DiscursivePage.tsx` (new) — mode select + single/prova flow.
- `components/discursive/{types,DiscursiveFilters,DiscursiveQuestionCard,DiscursiveRunner,
DiscursiveResult}.tsx` (new).
- `shared/lib/ai-eval-service.ts` (new) — browser relay client (`aiComplete`).
- `App.tsx` — route `/discursive`. `components/Layout.tsx` — nav "2ª Fase".
- `vite-env.d.ts` — `VITE_AI_SERVICE_URL?`.

Env / secrets:

- `api/.env` (gitignored) — created; the user pasted their Gemini key + `AI_MODEL=gemini-3.1-flash-lite`.
- `api/.env.example` (tracked) — template.

### Central relay (`/Users/arthurnunes/Library/MRHEWBUC-LOCAL/mrhewbuc-issues`, branch `main`, UNCOMMITTED)

- `src/handler.ts` — added `task: "complete"` generic Gemini relay (`geminiComplete`,
  `getModel` reads `ai-model` from SSM per-request). NOTE: this file also has a
  pre-existing uncommitted "close issue" feature that was already there before this work —
  leave it.
- `template.yaml` — timeout 30s; comments document the AI SSM params (no IAM change —
  existing `mrhewbuc/issues/*` read policy covers `ai-api-key`/`ai-model`).
- `README.md` — documented the relay (task=complete, Gemini, SSM params).

### AWS (shared account 394559824800, sa-east-1) — DONE

SSM parameters set (values read from `api/.env`, never printed):

- `/mrhewbuc/issues/ai-api-key` — SecureString (the Gemini key).
- `/mrhewbuc/issues/ai-model` — String = `gemini-3.1-flash-lite`.

### Memory updated

`~/.claude/.../memory/`: `project_2fase_discursive.md`, `project_issue_service.md`, `MEMORY.md`.

---

## Verification

- Lexflow: `pnpm check` (both tsconfigs), `pnpm lint` (`--max-warnings 0`), `pnpm test`
  (57 tests) — all green at last run.
- Central: `pnpm check` — green.
- RDS: discursive tables (0009) + `app_config` (0010) confirmed present.

---

## Remaining to go live online (AFTER the RDS objection is resolved)

1. Deploy `mrhewbuc-issues` (commit + push to its `main` → its CI deploys). Function URL:
   `https://calvwcs2st3frn6qkfwj6rhdta0foavj.lambda-url.sa-east-1.on.aws/`.
2. Set `VITE_AI_SERVICE_URL` to that URL — lexflow local `.env` + GitHub PROD env secret.
3. Deploy lexflow (commit + push `main` → CI builds frontend + API).
4. Save real question data so the picker isn't empty:
   `pnpm import:2fase:save scripts/out/xl-civil_law.draft.json`.

---

## Watch out for

- **Shared AWS account** (394559824800) — be careful. Deploys are GitHub-Actions-only;
  never `sam deploy` from a laptop. Migrations: `db:generate` → review → `db:migrate`.
- **The Gemini key** sits in `api/.env` (gitignored) and in SSM `ai-api-key`. Don't commit
  `api/.env`. Don't echo the key.
- **Key format looks unusual** — it starts with `AQ.` (standard Google AI Studio keys
  start with `AIza`). If grading 401s, the key may be an OAuth token (wrong header / expires),
  not an API key. Verify with the user.
- **Model `gemini-3.1-flash-lite`** — not verified to exist for this key. If grading 404s,
  list models at `https://generativelanguage.googleapis.com/v1beta/models` and pick a valid one.
- **Backend-direct (`gradeWithAi`) cannot work in prod** (no NAT) — it's local-dev only;
  online uses the relay. The hybrid runner already handles this via `VITE_AI_SERVICE_URL`.
- Nothing is committed/pushed/deployed — the working trees of both repos hold all code changes.
