# AI monetization — subscription allowance + credits add-on (retire the daily quota)

**Goal** — Replace the provisional daily anti-abuse quota with the owner's real model:
a paid subscription that includes a monthly AI allowance, plus credits as a paid add-on
for extra AI actions. One spend model, priced consume × 2.

## Owner's model (this supersedes the shipped daily quota)

Captured verbatim in Business rules below. In plain terms:

- **Subscription is the base.** A subscriber gets a monthly allowance of AI actions
  (the owner's "amount of ai_explanation quota per month"). This is an _entitlement_,
  not an abuse cap.
- **Credits are an add-on.** Once the monthly allowance is spent, the student buys credits
  to keep using AI. Credits are priced at **consume × 2** (2× the real LLM cost = margin).
- **The daily anti-abuse quota (`ai_usage_daily`: 30 tutor / 3 coach) is dropped.** The
  owner does not want it — credits + subscription allowance are the real control.
- **Per turn, not per profile.** Metering counts each AI turn/action, not a modelled
  user profile.

## Scope (in)

- **S1 — Retire the daily abuse quota.** Remove `assertAndIncrementQuota` enforcement from
  the tutor and coach procedures so the shipped 30/3 caps no longer gate anything. The owner
  explicitly does not want daily quotas. (`ai_usage_daily` table + `api/lib/ai-quota.ts` may
  be left dormant or dropped — see Open questions.) This is the one immediately buildable,
  verifiable slice and it directly answers the original quota question: **no daily quota.**

## Scope (out)

**Owner directive on where rules live (verbatim):** "claude.md, we need a real document,
convention and rule. not IN THE AGENT INFORMATION... THERE IS NO REASON TO THAT BE CLAUDE.MD.
I want that to be int he code". So the monetization rule must NOT go into CLAUDE.md agent
info — it belongs as a real convention doc (e.g. `docs/monetization.md` per the existing
`docs/conventions.md` pattern) and expressed in code (the credit costs / consume×2 pricing as
typed constants), authored during the build. The designer does not write that convention/code
(builder's job); S1 acceptance requires it.

- **Subscription + monthly-allowance implementation** — schema, entitlement counter, billing
  integration. Captured here as the target model but NOT built in S1; it needs the model +
  pack-pricing + payment-provider decisions (open items 2–4 on the v1 handoff) resolved first.
  Parked as its own build slice below.
- **Model choice** (`pnpm eval`) and **credit-pack BRL pricing** — separate open items; the
  consume × 2 rule can't be turned into numbers until the model (hence real cost) is picked.
- **`COACH_MIN_ANSWERED` (=20)** — the owner did not want to engage with it ("I don't know
  what that means" / "we need to simplify"). It is a data-sufficiency quality gate on the
  Coach, unrelated to monetization. Left untouched; revisit separately if ever.
- Payment provider / purchase flow — Stripe / Mercado Pago-Pix / IAP still undecided (handoff
  open item 4). Coupons remain the only top-up until then.

## Business rules / product facts (owner's own words, verbatim)

> "we need to have credits, based in the consume x margin (2x), I dont want quotas.
> only ONE functionlity is by quotas, the tutor/buddy, is cfedit based."

> "not per profile. per turn"

> "separated items. the user will subscribed, and has an amount of ai_explanation quota
> per month. CREDITS, is a addon"

> "WE NEED TO SIMPLIFY NOW, NOT LATER."

Reading (for downstream agents): the "quotas" the owner rejects = the daily anti-abuse caps.
The "amount of ai_explanation quota per month" he _wants_ = the subscription's monthly
allowance (a different concept — an entitlement, not an abuse throttle). Credits sit on top
of that allowance as a paid add-on, priced at 2× real LLM cost.

## Acceptance (S1 only)

- Tutor (`tutorAsk` in `api/trpc/routers/ai.router.ts`) no longer calls
  `assertAndIncrementQuota`; a user with credits can make >30 tutor calls in one day and is
  never blocked by a FORBIDDEN "Limite diário de IA atingido" — only by running out of
  credits (`assertCredits`).
- Coach (`generate` in `api/trpc/routers/coach.router.ts`) no longer calls
  `assertAndIncrementQuota`; >3 coach generations in a day are not blocked by the daily cap.
- `grade` is unchanged (it never had a daily counter; owner confirmed **No** to adding one).
- `pnpm validate` green (tsc both configs, eslint --max-warnings 0, vitest) — any test
  asserting the old daily-limit FORBIDDEN path is removed or updated.
- Config surface of the change is documented in the issue: it is a **code change** (delete
  the two enforcement calls + the now-unused `TUTOR_DAILY_LIMIT` / `COACH_DAILY_LIMIT`
  constants), NOT an SSM param and NOT (in S1) a schema migration.
- A real **convention doc** (`docs/monetization.md`, sibling to `docs/conventions.md`) states
  the model: subscription monthly allowance + credits add-on at consume × 2, no daily quota.
  Per owner directive this rule lives in the code/docs, NOT in CLAUDE.md.

## Change surface (where the shipped quota lives)

- `api/lib/ai-quota.ts` — `assertAndIncrementQuota` (the enforcement fn).
- `api/trpc/routers/ai.router.ts:99` — `assertAndIncrementQuota(ctx.userId, "tutor", TUTOR_DAILY_LIMIT)`.
- `api/trpc/routers/coach.router.ts:177` — `assertAndIncrementQuota(ctx.userId, "coach", COACH_DAILY_LIMIT)`.
- Constants: `TUTOR_DAILY_LIMIT=30` (`shared/domain/ai-tutor.ts:23`),
  `COACH_DAILY_LIMIT=3` (`shared/domain/ai-coach.ts:18`).
- Table: `ai_usage_daily` (`drizzle/schema-ai.ts`, `TABLE_SCOPE` in `api/db/scope.ts`,
  migrations 0016/0018).

## Applied recommendations

| Decision               | What was applied                                              | Why                                                                              |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Daily abuse quota      | Drop it (S1 removes enforcement)                              | Owner: "I dont want quotas"; credits are the real control                        |
| grade daily counter    | Not added                                                     | Owner picked "No — grade stays credits-only"                                     |
| `COACH_MIN_ANSWERED`   | Left at 20, out of scope                                      | Owner declined to engage ("simplify now"); it's a quality gate, not monetization |
| Scope of S1            | One small slice = remove enforcement; park subscription build | Owner wants simple now; subscription needs pricing/model/payment decisions first |
| Where the change lives | Code constant/call removal, not SSM, not schema (S1)          | Removing enforcement needs no infra; table can stay dormant                      |

## Later (parked — the target monetization model, needs its own PRD + decisions)

- **Subscription + monthly AI allowance**: schema for a per-user monthly entitlement counter
  (per-turn decrement), reset monthly; UI showing allowance remaining.
- **Credits as add-on above the allowance**: spend from allowance first, then credits.
- **Pricing**: turn "consume × 2" into BRL numbers once the model (open item 2) is chosen so
  real cost per action is known → sets credit-pack price and allowance sizing.
- **Payment provider / purchase flow** (Stripe / Mercado Pago-Pix / IAP) — coupons are the
  stopgap top-up until this exists.
- Decide whether to physically drop `ai_usage_daily` + `api/lib/ai-quota.ts` or keep dormant.

## Open questions (block S1 build)

- **Drop vs. dormant**: for S1, remove only the two enforcement calls (fastest, reversible),
  or also delete `ai_usage_daily`, `api/lib/ai-quota.ts`, and the constants? Recommendation:
  remove enforcement + the now-dead constants now; leave the table + a migration to a Later
  slice (dropping a table is heavier and the subscription work may reuse a usage counter).

## Dependencies flagged (owner-stated)

- Subscription allowance sizing + credit-pack BRL price both depend on **model choice**
  (open item 2, `pnpm eval`) — real LLM cost per action is the input to "consume × 2".
  Do not guess numbers before the model is picked.
- Purchase flow depends on **payment provider** (open item 4).
