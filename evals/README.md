# LexFlow OAB — A/B Eval Harness (promptfoo)

Compares OpenAI vs Google Gemini on the two OAB AI tasks:

- **oab-explain** (1a fase): objective question explanation → JSON `{whyCorrect, whyWrong, memoryTip, commonTraps}`
- **oab-grade** (2a fase): discursive answer grading → JSON `{score, feedback}`

Prompt text is extracted **live** from `api/lib/ai-prompts.ts` via `evals/prompts.js` —
no divergent copy to maintain.

---

## Setup (one-time)

```bash
# 1. Install promptfoo
cd evals
pnpm install

# 2. Compile the better-sqlite3 native binding (Node 22 requires this)
cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
npx node-gyp rebuild
cd ../../../../..   # back to evals/

# 3. Set env vars (add to api/.env or export in shell)
export OPENAI_API_KEY="sk-..."          # from api/.env OPENAI_API_KEY
export GOOGLE_API_KEY="..."             # same key as AI_API_KEY in relay SSM
# export ANTHROPIC_API_KEY="..."        # future — uncomment provider in config
```

## Running

From the **repo root**:

```bash
pnpm eval              # run eval, open interactive browser UI
pnpm eval:output       # run eval, save JSON to evals/results/latest.json
pnpm eval:view         # open promptfoo UI without re-running
```

Or directly from `evals/`:

```bash
cd evals
node_modules/.bin/promptfoo eval --config promptfooconfig.yaml
node_modules/.bin/promptfoo view
```

## Results

Results land in promptfoo's local SQLite store (`~/.promptfoo/` by default) and in
`evals/results/latest.json` when using `pnpm eval:output`.

The `evals/results/latest.json` file is gitignored — commit it manually if you want
a snapshot in the repo.

## Adding providers

Edit `evals/promptfooconfig.yaml` → `providers` block. Anthropic example is already
commented in. Each provider needs its API key in env.

## Adding test cases

Add entries to the `tests:` array in `promptfooconfig.yaml`. Use `task: explain` vars
for oab-explain rows and `task: grade` vars for oab-grade rows — see existing entries
for the required var names.

## Prompt drift

If `api/lib/ai-prompts.ts` changes, the eval picks up the new text automatically on
the next run (no manual sync needed).
