# Monetization model

**This is the single authoritative monetization document for LexFlow.** The rule lives
here — NOT in CLAUDE.md agent instructions. Per the owner directive (#50, superseding the
earlier #49-era framing), this file holds everything in one place: the two-currency model,
the verbatim owner business rules, the full build-slice plan, the acceptance criteria, the
parked list, and the owner-parked open questions.

**Status:** build-ready. Result of a fresh, multi-turn owner interview (2026-07-24)
grounded in the current code. This document is the sole source of truth — no other
monetization doc exists.

---

## Model — TWO separate currencies (authoritative, #50)

Two **separate currencies**. This split is the correction that drove the redo.

- **ALLOWANCE covers CORE ONLY.** Core = **"AI explanation (1 and 2)"** — phase-1 (objective
  question explanation) + phase-2 (discursive grading/explanation). **Nothing else.** The
  subscription grants a monthly allowance for this; the free tier gets a small daily amount.
  Core overflow = **buy MORE allowance**, never credits (the per-explanation cost is
  predictable). Reset on **subscription anniversary**; rollover **one month max**.
- **CREDITS cover EVERYTHING ELSE.** The interactive per-question buddy, the coach analysis,
  and future features (e.g. a "researcher" that does not exist yet). This is the existing
  pay-as-you-go `credit_ledger`, kept. Bought credits never expire.
- **Per turn, not per profile.** Metering counts each AI turn/action individually.
- **All prices/sizes are admin-editable DB table rows**, seeded by a proper hybrid
  calculation from the eval cost — **NEVER hardcoded, never a "magic number".** No number is
  in this document. Owner directive.
- **Cached explanations are FREE.** A populated `oab_questions.ai_explanation` is served with
  no LLM call → no allowance/credit charge. Only **live** LLM calls are metered.
- **Free-tier daily entitlement, not an abuse cap.** Free users get **1 core AI use per day**
  (calendar-day reset, America/Sao_Paulo). The old #49-era anti-abuse caps (`ai_usage_daily`)
  are retired.

---

## Business rules / product facts (owner's own words, verbatim)

- _"CORE ARE THE FUNCTIONALITIES ARE: AI EXPLANATION (1 and 2) that is it. NOTHING MORE.
  CREDITS = EVERYTHING ELSE"_
- _"CREDITS ARE FOR SOMETHING ELSE, NOT FOR CORE FUNCTIONLITIES."_
- _"buy more allowence, because is easy to know the average coast with more precision"_ (core
  overflow = buy more allowance, not credits).
- _"we need a proper credit calculation, not MAGIC NUMBERS. because, the ai explanation, after
  while, we be solved already."_ (cached explanations fill up over time → cheaper to run).
- _"I DONT WANT YOUR CALCULATION, I WANT A PROPER CALCULATION ... IS NOT YOUR CALL, WE NEED TO
  BE ABLE TO EASILY CHANGE ON TABLE LEVEL"_ + _"i want the developer to proper do a clculation
  based in real numbers and have a hybrid aproach, I have that already in other project."_
- Free tier: _"free tier has one IA use a day."_
- Rollover: _"only one month."_
- Top-ups: _"user may ask new allowence credtis in the system, we can give for free"_ +
  _"admin create a cupom to be used by the user and auto applied."_
- Payment: _"dont connect with gateway yet, for now, only cupom"_ / _"build the code, dont
  include any gateway yet"_.
- Copy: _"DONT CHANGE COPY NOW"_ and (earlier standing) _"PLEASE REMOVE EVERYTHING FROM ANY
  DOCUMENT ABOUT TUTOR"_ — code identifier `tutor` stays; only docs/copy avoid the word, and
  copy is not touched this build.

---

## Build plan

### Scope (in)

- **S1 — Subscription + allowance schema (+ migration).** A `subscriptions` entity (plan +
  period + status) and a **month-grained allowance counter** for core AI (phase-1 explanation
  - phase-2 grading). Reset on **subscription anniversary**; rollover **one month max**. Drop
    the dead `ai_usage_daily` table + delete `api/lib/ai-quota.ts` (dormant since #49). Add
    `TABLE_SCOPE` entries for every new table.
- **S2 — Free tier daily counter (+ migration).** A fresh **daily** counter: free users get
  **1 core AI use per day** (any core action), **calendar-day reset (America/Sao_Paulo)**.
  This is a NEW counter — the retired `ai_usage_daily` is not reused.
- **S3 — Spend engine + move grading onto allowance.** Core actions (phase-1 explanation +
  phase-2 grading) draw the allowance; overflow requires buying **more allowance** (never
  credits). Non-core (buddy, coach) stay on the existing `credit_ledger` via
  `assertCredits`/`debitCredits`. **Move `grade` OFF credits onto the allowance rail.** Keep
  the idempotent refund rail on both. Cached explanation (`oab_questions.ai_explanation`)
  stays FREE — only LIVE LLM calls are metered.
- **S4 — Coupon `kind` (allowance | credits | subscription).** Extend the coupon system so a
  coupon carries a kind and grants allowance, credits, or a subscription period — admin picks
  at mint time, auto-applied on redeem. Preserve the existing atomic-cap + per-user
  replay-guard rails.
- **S5 — Admin-editable pricing/config table.** All numbers (plan price, allowance size, pack
  sizes, real-cost-per-unit) live as **editable DB rows**, changeable with no deploy, seeded
  by a proper hybrid calculation from the eval cost. **No number is hardcoded and no number is
  in this document.** Guard against going live unset.
- **S6 — Subscription grant paths (no gateway).** Grant the paid plan via a **subscription
  coupon** OR an **admin action** (both). The subscription entity is built now so a payment
  gateway plugs in later.
- **S7 — Frontend surfaces.** Show allowance-remaining (where core AI is used), credit balance
  (where buddy/coach are used), a redeem-coupon input (all 3 kinds), and a billing/account
  screen (plan + both balances + ledger). pt-BR. **Do NOT change any existing copy.**

### Scope (out)

- **Payment gateway (Mercado Pago / Stripe / IAP).** Owner: _"dont connect with gateway yet,
  for now, only cupom"_ — build the engine, grant via coupon/admin, gateway is a later issue.
  It is OUT by owner choice, not blocked.
- **Buy-buttons / real purchase flow.** No gateway → no checkout this build. Only
  redeem-coupon.
- **Copy changes / "tutor" rename.** Owner: _"DONT CHANGE COPY NOW."_ Existing UI wording and
  the code identifier `tutor` are untouched (rename is a separate parked slice).
- **The "researcher" feature.** Named as a future credits consumer; not built here.
- **Charging for cached explanations.** Cached `ai_explanation` views stay free.
- **Concrete prices / allowance sizes.** Owner directive: a proper calculation, admin-editable,
  not the designer's call.

### Acceptance

- **Currency split:** a phase-1 explanation and a phase-2 grade debit the **allowance**, never
  `credit_ledger`; a buddy turn and a coach generation debit **`credit_ledger`**, never the
  allowance. (Assert via ledger/counter row after each action.)
- **grade moved:** `ai.grade` no longer calls `assertCredits`/`debitCredits`; it asserts/debits
  the allowance. Regression test guards it.
- **Free tier:** a free user's 2nd core AI action in the same America/Sao_Paulo calendar day is
  refused; a paid subscriber is not.
- **Overflow:** with allowance at 0 and a paid plan, a core action is refused with a
  buy-more-allowance path (not a credit debit); a bought allowance top-up unblocks it.
- **Rollover:** unused allowance carried into the next period is capped at one month's worth;
  older expires. Bought credits never expire.
- **Cached explanation:** viewing a question whose `ai_explanation` is already populated debits
  **nothing** (no allowance, no credit).
- **Coupon kinds:** an `allowance` coupon raises the allowance; a `credits` coupon raises the
  credit balance; a `subscription` coupon activates a subscription period. Existing atomic-cap +
  per-user replay guard still hold (double-redeem refused).
- **Config table:** changing a price/size row changes behaviour with no redeploy; the system
  refuses to serve a live price while the real-cost seed is unset. `[human check]` on the final
  seeded numbers being sane (owner-owned).
- **Dead code gone:** `ai_usage_daily` table dropped, `api/lib/ai-quota.ts` deleted; `pnpm
check` + `pnpm lint` + `pnpm test` green.

### Skill notes

- `docs/conventions.md` — LOV/English-code-pt-BR-label; no-duplication;
  business-rules-in-`shared/`; refactor playbook for `max-lines-per-function`.
- `api/db/scope.ts` — every new user-owned table needs a `TABLE_SCOPE` entry (subscriptions,
  allowance counter, free-daily counter are user-scoped; coupons stay global).
- Money invariants (`api/lib/credits.ts` header): balance = SUM(delta), unique `ref_id`
  idempotency, refund on failed relay job — the allowance rail must mirror these.
- Migrations: `db:generate` → review SQL → `db:migrate`. Never hand-apply, never `db:push`.
- No new dependency without approval. `console.warn/error` only, no `any`, no non-null `!`.
- Provider/config numbers pattern: developer researches
  `/Users/arthurnunes/Library/MRHEWBUC-LOCAL/maggie` and `Coghatch-ai/maggie#206` for the
  table-level pricing + hybrid-cost approach (owner-provided reference; designer did NOT read it).

### Applied recommendations

| Decision                       | What was applied                                                                            | Why                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Free-tier daily reset timezone | America/Sao_Paulo                                                                           | Audience is Brazilian; owner said "calendar day, fixed timezone" without naming one.    |
| Cached explanation billing     | Cached views stay FREE; only live LLM calls metered                                         | Matches the global-cache design + owner's "gets solved already" logic; owner confirmed. |
| Credit system reuse            | Reuse `credit_ledger` + `assertCredits`/`debitCredits` for buddy/coach; move `grade` off it | Least churn; the shipped system already is this minus grading. Owner confirmed.         |
| Money invariants on allowance  | Mirror ledger pattern (SUM balance, unique ref_id, idempotent refund)                       | Consistency with the proven credit rail.                                                |
| Document carries NO numbers    | Only mechanism + formula documented                                                         | Owner directive, emphatic and repeated.                                                 |

---

## Enforcement (current shipped state, pre-build)

The build plan above changes this. Recorded here as the starting point the slices modify.

- `api/lib/credits.ts` — `assertCredits` / `debitCredits` — the current spend gate.
- `api/trpc/routers/ai.router.ts` (`tutorAsk`) — credits (non-core; stays on credits).
- `api/trpc/routers/coach.router.ts` (`generate`) — credits (non-core; stays on credits).
- `api/trpc/routers/ai.router.ts` (`grade`) — currently credits; **S3 moves it onto the
  allowance rail** (core).
- `ai_usage_daily` table + `api/lib/ai-quota.ts` — dormant; **S1 drops the table + deletes the
  file**.

---

## Later (parked)

- Payment gateway integration (Mercado Pago Pix+card / Stripe / IAP) + real checkout + in-app
  cancel-at-period-end.
- The "researcher" feature (a future credits consumer).
- Copy pass / "tutor" → "AI explanation" rename across UI + code identifiers.
- "Insufficient" empty-pool block message with a buy CTA (needs the gateway).

## Open questions (owner-parked by their own choice)

- The exact numbers (plan price, allowance size, pack sizes, real-cost-per-unit) — owner-owned,
  seeded from the eval cost via the developer's hybrid calculation. Blocks go-live pricing only,
  not the engine build.
- What "everything else / researcher" credits ultimately buy beyond buddy + coach — owner:
  _"something I dont know yet."_ Does not block this build (credits engine is generic).
