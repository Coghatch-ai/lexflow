# Monetization foundation port — internal research findings

**Purpose:** tech-only refactor. Port our monetization money-core onto the canonical
delivered-only metered-credit engine documented in GitHub issue **#57** (a spec written from
**Maggie** `arthur0n/maggie` #218). No business decisions — the product model below is the
owner's decision, already made.

## Owner's confirmed business model (authoritative product intent)

- Every user's AI consumption must be **attributable/reportable in one unified cents ledger**.
- **Subscription = a recurring monthly GRANT of credits** into that ledger (kind `grant`,
  `source: subscription`). The user SEES it as an "allowance" entitlement, **not** as purchased
  credits — but internally it is ledger credits, so it is reportable exactly like any other grant.
- **Coupons grant the same way.** Purchased credit packs grant the same way.
- **One balance, one engine.** The allowance-vs-purchased distinction is a
  presentation/reporting concern carried by ledger `source`/`kind`, **not** two separate balances.
- **Refund** is kept as a real-but-**dormant** ledger kind/flag (not needed here because delivery
  is confirmed post-delivery, but preserved so the solution stays a faithful copy of the canonical).

## Canonical target (#57 / Maggie #218) — summary for the reviewer

- **4 tables:** `credit_ledger` (append-only signed `delta_cents`; kind grant/purchase/refund/
  consumption/adjustment; open-string `source`; unique `ref_id`), `credit_balances` (materialized
  1:1; `balance_cents` int, `bag_cents numeric(12,4)` fractional accumulator ON the balance row,
  `reference_cents` gauge anchor), `credit_charges` (`ref_id` PRIMARY KEY; idempotency + fractional
  attribution), `credit_config` (`key→value_int` live knobs, `mult.<source>`).
- **Invariant:** `balance_cents == SUM(credit_ledger.delta_cents)` per user; every mutation touches
  ledger+balance in ONE transaction in ONE file that is the ONLY writer; bag is off-ledger.
  Balance mutation is always `INSERT … ON CONFLICT DO UPDATE`, never a bare UPDATE.
- **Pure money math:** `applyMultiplier(raw, multX100)` fractional never rounded; `flushBag(bag,
owed)→{floor flush, remainder}`; multiplier fixed-point ×100 int (200=2x); source OPEN string
  (unlisted → DEFAULT 100=1x); clamp stored mult to [0,10000]; cap rawCents.
- **`charge(scope, source, rawCents, refId, delivered, dryRun)`** in one tx: `delivered:false` =
  universal no-op (no tx at all); `dryRun` = shadow (writes nothing, logs would-flush); idempotency
  via `INSERT credit_charges … ON CONFLICT DO NOTHING RETURNING` (empty = replay → bag does NOT
  re-accumulate); accrue owed into bag under row lock; `floor(bag)<1` → no ledger row; else one
  `consumption` row = balance decrement, same tx. Negative balance kept real (no `>0` guard at
  charge — the NEXT admission read denies).
- **Admission** = balance READ, deny `<= 0` (grace: last cent completes, next denied). Fail-CLOSED
  with a burst allowance (`burstAdmit`, BURST=3) on read failure; separate fail-OPEN door for
  non-spend actions. **`CREDITS_MODE`** rail: unset=enforce, `shadow`=dryRun+never deny, `off`=skip.
  Ship shadow first, then flip.
- **Charge-loss:** caller `charge()` never throws into the request path; logs `[credits]
charge-LOST … refId=…`; schedules ONE idempotent background retry; logs `charge-RECOVERED`.
- **Raw cost** table (cost-of-goods) SEPARATE from the billing multiplier; `costFor(model,usage)`
  never throws (unknown model → 0); guard test that every model id in use has a rate row.
- **Wallet read:** `reference_cents` snapshotted at last positive money-in (grant/purchase only);
  `percent = clamp(balance/reference,0,100)` computed SERVER-side; client renders a fuel gauge,
  never sees a dollar figure, never recomputes reset logic.
- **Funding:** coupons `XXXX-XXXX` (ambiguous glyphs excluded), atomic per-coupon cap via
  conditional `UPDATE … WHERE redeemed_count < max RETURNING` (never COUNT(ledger)); IAP grant from
  server-side pack map keyed by verified productId; NO auto signup grant (farmable).
- **#57 §10 explicitly says DO NOT port:** the legacy fixed per-action price table + debit-at-
  admission model — that was Maggie's v1; the metered post-delivery engine replaced it.

## Current state (ours) — gap vs canonical

**Headline: our foundation IS Maggie's v1 — the exact design #57 §10 says not to port.** All three
independent research passes agreed.

### Data model + money core (`drizzle/schema-ai.ts`, `api/lib/credits.ts`, `ledger-debit.ts`, `shared/domain/credits.ts`)

- **No `credit_balances`** — balance is DERIVED `SUM(delta)::int` (`credits.ts:22`). No materialized
  row → **no bag, no `reference_cents`**. MISSING.
- **No `credit_charges`** table. Idempotency lives on the ledger via unique `ref_id` +
  `ON CONFLICT DO NOTHING RETURNING` + replay-vs-insufficient re-SELECT (`ledger-debit.ts:129-148`)
  — canonical-grade logic, but on the ledger, not a separate attribution table. PARTIAL.
- **No fractional money / bag.** Costs are whole ints (`CREDIT_COSTS={tutor:1,coach:2}`,
  `credits.ts:17-20`). No `applyMultiplier`/`flushBag`/multiplier/sub-cent path. MISSING.
- **No `charge()` engine, no `delivered` flag, no `dryRun`/`CREDITS_MODE`.** Closest is
  `debitCredits`→`atomicDebitCredits` (`ledger-debit.ts:191`): fixed-cost, **pre-delivery**, DENIES
  on insufficient (`WHERE sum(delta) >= cost`). Opposite phase; negative balance structurally
  impossible (canonical keeps it real). DIVERGENT.
- **One-writer/one-tx invariant: NO.** Spends go via a helper, but refund + grant do raw
  `db.insert` (`credits.ts:67`/`:89`); allowance + coupon rails also write; `ledger-debit.ts:32`
  explicitly excludes refund/grant. Multiple writers, TWO parallel int ledgers (+ free_daily_counter).
- **`pricingConfig`** (`schema-ai.ts:222`) is `key→numeric(18,4)` BRL pricing, NOT `credit_config`
  int `mult.<source>` knobs. DIVERGENT.
- **Refund** already first-class: `LedgerAction "refund"` (`shared/domain/credits.ts:28`), allowance
  action set has `refund` (`schema-ai.ts:72`), `refundCredits` idempotent. Easy to demote to dormant.

### Spend engine + admission + config + call sites (`api/lib/allowance.ts`, `subscription.ts`, `pricing-config.ts`, `credits.router.ts`)

- **Debit-at-admission, not post-delivery.** `debitAllowance`/`debitCredits` commit BEFORE
  `enqueueRelayJob` (`ai.router.ts:99-104`, `questions.router.ts:269-274`; `spend-order.test` R1/R3).
  Forces the refund rail (`refundAllowance` `allowance.ts:211`, `reverseFreeTierCounter`,
  `refundCredits`). **Riskiest gap:** a relay job that fails/stalls AFTER a successful enqueue
  reverses only via the relay `status:error` path — any **lost/stuck job = committed debit, no
  delivered work, no auto-refund → user paid for nothing.** Delivered-only charging deletes this class.
- **Fixed enum price table** (`CREDIT_COSTS`, `ALLOWANCE_COST=1`) vs open-string ×100 multiplier —
  §10 says drop it. No multiplier/cents/bag. MISSING.
- **No `CREDITS_MODE` shadow rail** (0 hits) — enforce-only, no canary/kill switch. MISSING.
- **No cost-of-goods table** — `costFor`/per-model rates absent; cost conflated into a hand-tuned
  constant. MISSING (§7).
- **Gate is `balance >= COST`, no grace, no fail-closed burst** (`assertAllowance`
  `allowance.ts:157`) vs canonical `<=0` deny + `burstAdmit`. DIVERGENT.
- **PORTED well:** coupon atomic cap (`UPDATE … WHERE redeemed_count < max RETURNING`,
  `credits.router.ts:242-257`); no auto-signup grant. IAP: MISSING (out of scope).
- `admin.generateExplanation` (`admin.router.ts:472`) is fully **unmetered**.

### Wallet read + frontend + docs + tests

- **No `reference_cents`, no server `percent`, no fuel gauge.** Reads (`credits.balance`,
  `credits.allowanceBalance`) return raw SUM integers (`credits.router.ts:151-172`,
  `allowance.ts:58-67`). §8 MISSING.
- **Client renders raw magnitude**, not a gauge (`BillingPage.tsx:125-139`, `AllowanceChip`,
  `CreditsChip`, + mobile mirrors). Not $/cents (unit is units/credits), but still a raw number vs
  §8 "gauge only". Percent is not a concept anywhere. DIVERGENT.
- **`docs/monetization.md`** self-declares authoritative but is DIVERGENT from #57 and cites
  maggie#206 (not #218) — must be reconciled on adoption.
- **Test coverage gaps** (acceptance guarantees with NO guarding test): invariant property test
  (incl. user whose first write is a charge); every-model-id-has-a-rate-row guard; fail-closed
  burst; plus all engine-dependent ones (sub-cent no-ledger, bag-crossing-1¢ flush, shadow
  zero-rows, `delivered:false` no-op, `charge-LOST`). All current money tests are source-text
  `toContain` guards; concurrency explicitly deferred.

## Proposed port direction (to be reviewed by Codex, then shaped into D1–D5 by the designer)

Port #57's delivered-only cents engine as the foundation; model the subscription allowance as a
recurring monthly **grant** into the same unified ledger (owner's business model above). Retire
debit-at-admission and the fixed per-action price table. Keep refund as a dormant kind. Reconcile
`docs/monetization.md`. Ship the charge path in `CREDITS_MODE=shadow` before enforce.

Rough slice shape (≤5, lean — designer finalizes):

- **D1** — schema + migration (`credit_balances` incl. `bag_cents`/`reference_cents`,
  `credit_charges`, `credit_config`; keep/extend `credit_ledger`) + pure money math + `charge()`
  shipped **dormant** + unit/property tests (invariant incl. first-write-is-a-charge, replay,
  sub-cent, flush).
- **D2** — subscription-as-monthly-grant + coupon/grant paths writing into the unified ledger; the
  allowance reads become a ledger view; refund demoted to dormant flag.
- **D3** — move the AI call sites (grade, explanation, tutor/coach) to admission-read + post-
  delivery `charge()`, in `CREDITS_MODE=shadow`; add cost-of-goods table + `costFor` + model-rate
  guard test; retire the fixed price table.
- **D4** — wallet read (`reference_cents` anchor + server `percent`) + UI gauge; reconcile chips /
  BillingPage (web + mobile) to render the gauge, never raw cents.
- **D5** — admission fail-closed burst + charge-LOST logging/retry; flip `CREDITS_MODE` to enforce;
  reconcile `docs/monetization.md` as the single source of truth.

(Number of slices is a recommendation, not a mandate — collapse if any two are trivially small.)
