# Monetization model

**This is the authoritative rule for all AI spend control in LexFlow.**
Per owner directive (issue #49 / `design/ai-monetization-subscription-credits.md`),
the rule lives here — NOT in CLAUDE.md agent instructions.

## Model

- **Subscription is the base.** A subscriber receives a monthly allowance of AI actions
  (the owner's "amount of ai_explanation quota per month"). This is an _entitlement_,
  not an abuse cap.
- **Credits are a paid add-on.** Once the monthly allowance is spent, the student buys
  credits to continue using AI. Credits are priced at **consume × 2** (2× the real LLM
  cost per action = margin).
- **Per turn, not per profile.** Metering counts each AI turn/action individually.
- **No daily quota.** The provisional daily anti-abuse caps (30 tutor / 3 coach via
  `ai_usage_daily`) have been retired. The credit system is the real control.

## Owner's words (verbatim, captured in design/ai-monetization-subscription-credits.md)

> "we need to have credits, based in the consume x margin (2x), I dont want quotas.
> only ONE functionlity is by quotas, the tutor/buddy, is cfedit based."

> "not per profile. per turn"

> "separated items. the user will subscribed, and has an amount of ai_explanation quota
> per month. CREDITS, is a addon"

> "WE NEED TO SIMPLIFY NOW, NOT LATER."

## Enforcement (current state — S1)

- `api/lib/credits.ts` — `assertCredits` / `debitCredits` — the only spend gate.
- `api/trpc/routers/ai.router.ts` (`tutorAsk`) — credits-only; no daily quota call.
- `api/trpc/routers/coach.router.ts` (`generate`) — credits-only; no daily quota call.
- `api/trpc/routers/ai.router.ts` (`grade`) — credits-only; no daily quota (owner confirmed).
- `ai_usage_daily` table + `api/lib/ai-quota.ts` — left dormant; enforcement removed in S1.

## What is NOT built yet (parked)

- Subscription schema + monthly-allowance counter (needs model choice + payment provider).
- Credits-above-allowance spend order.
- BRL pricing (blocked on model cost data from `pnpm eval`).
- Purchase / payment flow.
