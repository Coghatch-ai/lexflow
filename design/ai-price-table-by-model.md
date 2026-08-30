# Price table by model — real usage, verified rates, margin in the multiplier

**Goal** — every AI charge is `real tokens × the verified price of the model that actually ran ×
the margin multiplier`, with no invented numbers anywhere in the chain.

## Scope (in)

One slice, by explicit user instruction (see Business rules). Build order inside the slice:

1. **Verified price pull (gate).** A research step pulls current first-party prices for the
   OpenAI model we will run and for the Gemini successors of the three retired ids. Output per
   model: source URL, provider page date, retrieval date, USD input price, USD output price.
   **The user approves the model choice and its numbers before any rate is written to code.**
2. **Price table by model, input and output split.** `COST_OF_GOODS`
   (`shared/domain/cost-of-goods.ts`) becomes `{ input, output }` cents per 1M tokens per model,
   **decimals allowed** (`gpt-4o-mini` = 37.5 today, not 38 — rounding a rate is a hidden
   markup). `costFor()` takes input and output token counts and returns
   `(in × inputRate + out × outputRate) / 1_000_000`. Every row carries its provenance comment.
   `LIVE_MODEL_IDS` stays 1:1 with the table (existing guard test).
3. **Model bump.** `DEFAULT_OPENAI_MODEL` (`api/relay/relay-handler.ts:39`) moves to the
   approved current model. Its row is in the table before the swap, never after.
4. **Reasoning effort `low`.** `api/relay/providers.ts:119` currently sends
   `reasoning: { effort: "none" }` for `gpt-5*` ids. It sends `{ effort: "low" }`.
5. **Real usage end to end.** `openaiComplete` / `geminiComplete` return the model id used and
   the provider-reported token counts alongside the text; the relay AI result payload becomes
   `{ success: true, data: { text, model, usage: { inputTokens, outputTokens } } }`
   (`relay-handler.ts:208`). Reasoning tokens are inside the provider's output count — they are
   billed, so they are metered.
6. **Doors meter what happened.** All five `consumeAndCharge` callers pass the relay-reported
   model and usage. The hardcoded token constants are **deleted**: `900` (`ai.router.ts:203`),
   `1200` (`coach.router.ts:227`), `2048` (`discursive.router.ts:310`, `questions.router.ts:346`,
   `admin.router.ts:589`). `PROD_DEFAULT_MODEL` / `resolveMeteringModel()`
   (`api/lib/ai-metering.ts:31-36`) are deleted with them — the model is no longer a default,
   it is a fact reported by the relay.
7. **No usage, no charge, no guess.** A result missing `usage` or `model`, or naming a model with
   no rate row, is treated as a delivery failure: `BAD_GATEWAY`, the caller's transaction rolls
   back, nothing persisted, nothing charged, no consumption marker.
8. **Margin lives only in the multiplier.** The +20% currently welded into the rate table
   (`45` where true cost is `37.5`; `750` where it is `625`) comes out of the table. Four
   `credit_config` rows are seeded: `mult.grade`, `mult.explanation`, `mult.tutor`, `mult.coach`
   = `120`. `MULT_DEFAULT_X100` stays `100`.
9. **Seed script.** New `scripts/seed-credit-config.ts` + `pnpm db:seed-credit-config`,
   idempotent upsert, same shape as `scripts/seed-lov.ts`. Run manually from a laptop, like
   `db:migrate`. **No schema change, so no drizzle migration and no `pre-push` gate involvement.**

## Scope (out)

- **Multiplier tuning UI / admin surface over `credit_config`** — already parked in
  `docs/monetization.md`; the seed script is enough to set a knob today.
- **Differentiated margin per source** — all four sources get `120`. Per-source tuning is what
  the knob is for, later, with usage data in hand.
- **Cached-input / batch pricing tiers** — providers price these separately; not modelled.
- **Changing `MULT_DEFAULT_X100`** — a source with no row still bills at cost (1×). Accepted:
  the four real spend sources are all seeded, and a silent 1× is safer than a silent 1.2×.
- **`pricing_config.real_cost_per_unit`** (the separate `pnpm eval` gate,
  `api/lib/pricing-config.ts:122-133`) — adjacent, untouched.

## Business rules / product facts

The user's own words, authoritative:

- **"ONE SLICE. STOP THE SUPER CONVOLUATED SMALL PIECES. ALL AT ONCE"** — this is deliberately
  one PRD, not the three-slice cut that was proposed and rejected.
- **"WE NEED THE CORRECT USE. WE NEED A "PRICE" TABLE BY MODEL. THAT IS IT"** — the two things
  that must be true: real usage, and a per-model price table. No fallback machinery, no
  estimates, no compensating fudge.
- **"lets bump the model. get the correct prices."**
- **"we dont need to use mini, the currenct values with low reasoning are better for the work I
  wnat"** — the target is a current full model run at low reasoning, not a mini tier.
- **"with LOW rasoning!"** — `effort: "low"`, explicitly not the `"none"` the code sends today.
- Missing usage is a **delivery failure**, chosen over falling back to estimates and over
  charging zero.
- Margin is held constant at **20%**, expressed as `mult.<source> = 120`. Price per call is
  allowed to move with real provider cost; the margin percentage is what stays fixed.
- The +20% presently sitting in `COST_OF_GOODS` is **intentional margin**, not a costing error.
  It is being relocated, not removed.

## Acceptance

Bindable checks. `pnpm validate` (tsc + strict lint + vitest) green is assumed throughout.

1. **Table shape.** `COST_OF_GOODS[m]` is `{ input: number; output: number }` for every model;
   rates are cents per 1M tokens and may be non-integer.
   `costFor(m, { inputTokens: 1_000_000, outputTokens: 0 })` equals that model's `input`;
   `{ inputTokens: 0, outputTokens: 1_000_000 }` equals its `output`; a mixed call equals the
   sum of both scaled parts.
2. **Provenance.** Every row in `COST_OF_GOODS` has an adjacent comment carrying: first-party
   URL · provider page date · retrieval date · USD input price · USD output price. A row without
   one fails review.
3. **No retired ids.** `LIVE_MODEL_IDS` contains none of `gemini-2.0-flash`, `gemini-1.5-flash`,
   `gemini-1.5-pro`; it contains the approved current OpenAI model and the approved Gemini
   successors. The existing 1:1 parity guard tests in `shared/domain/cost-of-goods.test.ts` stay
   green (both directions).
4. **`costFor` stays total and pure.** Unknown model → `0`, never throws;
   `hasCostRate("no-such-model") === false`. (Refusal happens at the door, not here.)
5. **Reasoning effort.** For a model id starting `gpt-5`, the OpenAI request body contains
   `reasoning: { effort: "low" }`. For a non-`gpt-5` id the key is absent.
6. **Relay reports usage.** The AI channel result is
   `{ success: true, data: { text: string, model: string, usage: { inputTokens: number, outputTokens: number } } }`;
   both counts come from the provider response (OpenAI `usage.input_tokens` /
   `usage.output_tokens`; Gemini `usageMetadata` prompt + candidates + thoughts), never computed
   locally.
7. **No hardcoded token counts survive.** A source-text guard test (same idiom as
   `api/lib/credit-charge.test.ts:237`) asserts no `usage: { kind: "tokens", amount: <literal> }`
   remains in `api/trpc/routers/*.ts`, and that `PROD_DEFAULT_MODEL` no longer exists.
8. **Refusal path.** For each of the five doors: a relay result with `usage` absent, with a
   non-finite/negative count, or with a `model` that has no rate row →
   `TRPCError code "BAD_GATEWAY"`, and afterwards **zero** rows added to `credit_ledger`,
   `credit_charges` and `ai_job_consumption`, and the door's own target write absent (the whole
   transaction rolled back).
9. **Client cannot steer metering.** The metered model is read only from the relay result
   server-side; no door reads a model from its tRPC input. Source-text guard.
10. **Margin maths.** With `mult.grade = 120` and a call of 1M input + 1M output on the approved
    model, `charge()` produces `owedCents === (inputRate + outputRate) × 1.2` exactly (no
    rounding step anywhere between `costFor` and `applyMultiplier`).
11. **Margin is out of the table.** `COST_OF_GOODS["gpt-4o-mini"]` (if the row is retained)
    equals the verified true rates — `input: 15, output: 60` — not the marked-up `45` blended.
12. **Seed script.** `pnpm db:seed-credit-config` run twice leaves exactly four rows —
    `mult.grade`, `mult.explanation`, `mult.tutor`, `mult.coach`, each `value_int = 120` — and the
    second run mutates nothing else. Script is idempotent (`onConflictDoUpdate` on `key`).
13. **Deploy order.** Documented in the PR body and followed: merge → API deploy (new table +
    new model default live) → `pnpm db:seed-credit-config` from a laptop → confirm the relay is
    running the intended model. Seeding **before** the deploy would apply 1.2× to the old
    marked-up rate (a 20% overcharge window) and is forbidden.
14. **[human check]** After deploy, run one real grading in prod and inspect the resulting
    `credit_ledger` consumption row: its amount matches (relay-reported tokens × approved rates
    × 1.2) to the cent, and `credit_charges.raw_cents` shows the pre-margin figure.

## Skill notes

- `docs/conventions.md` — business rules live in `shared/`; the price table and `costFor` stay
  there, the DB knob stays in `credit_config`.
- `api/lib/credit-charge.ts` is the **single writer**; this slice adds no new ledger writer.
- Backend runs `tsconfig.api.json` max-strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) — the widened result payload must be parsed, not cast.
- No `console.log`, no `any`, no `!` (CLAUDE.md NEVER list).
- Deploy is GitHub Actions only; SSM `/lexflow/relay/prod/openai-model` may override the code
  default and must be checked, not assumed.
- No dependency may be added without approval.

## Applied recommendations

| Decision                     | What I applied                                                        | Why                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Multiplier rows              | `mult.grade` · `mult.explanation` · `mult.tutor` · `mult.coach` = 120 | Exactly the four sources that reach `charge()` via `consumeAndCharge`; grants are unaffected by the multiplier |
| Default when a row is absent | `MULT_DEFAULT_X100` stays `100` (bills at cost)                       | A missing knob should under-bill, never silently mark up                                                       |
| Seeding mechanism            | New idempotent `scripts/seed-credit-config.ts` + pnpm script          | Matches `seed-lov.ts`; migrations here are DDL-only (zero `INSERT` in `drizzle/*.sql`)                         |
| Who applies it               | You, from a laptop, after deploy                                      | CI cannot reach the DB (no-NAT VPC) — same constraint as `db:migrate`                                          |
| Ordering                     | Deploy first, seed second                                             | The reverse creates a 20% overcharge window                                                                    |
| Dead Gemini rows             | Replaced by approved successors, not deleted                          | You asked for the Gemini prices in the same pull; parity guard stays meaningful                                |
| Metering-model divergence    | Closed by construction — the charged model is the one the relay ran   | The OpenAI-rate-for-Gemini-spend hole disappears once the model is reported, not assumed                       |
| 1:1 blend assumption         | Dropped entirely (split input/output rates)                           | With real counts there is no blend left to assume                                                              |
| Rounding                     | None — decimal rates                                                  | Rounding 37.5 up is a permanent invisible markup on the only rate ever charged                                 |

## Later

- Multiplier tuning UI / admin surface over `credit_config` (already parked in
  `docs/monetization.md`).
- Per-source margins once real spend data exists (grading is output-heavy; tutor is not).
- Cached-input and batch pricing tiers.
- Spend reporting from `credit_ledger` by `source` / model.
- Alert when a relay result names a model with no rate row (today it is a refusal in the logs).

## Open questions

- **The rates themselves.** The research pull must land and be approved before implementation
  starts. Nothing else blocks; this one blocks everything.
- **Does SSM `/lexflow/relay/prod/openai-model` currently hold an override?** If it does, the
  code default alone will not bump the model. To be checked during the deploy step, not a design
  fork.
