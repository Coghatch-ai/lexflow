# Monetization model

**This is the single authoritative monetization document for LexFlow.** The rule lives
here — NOT in CLAUDE.md agent instructions.

**Status:** unified engine live (D1–D4, epic #50 — canonical target #57/#218). As of D4 the
NO-LEGACY cutover is complete: there is ONE credit engine and no backward-compat scaffold.
The earlier two-currency framing (separate allowance + pay-as-you-go rails, a fixed per-action
price table, a free-tier daily counter, and a `CREDITS_MODE` shadow-migration rail) has been
DELETED — this document supersedes it entirely.

---

## Model — ONE unified credit engine

There is a SINGLE append-only money ledger and a SINGLE materialized balance per user.

- **`credit_ledger`** — append-only signed rows. `kind ∈ {grant, purchase, refund,
consumption, adjustment, expiry}`; `source` is an open string (`subscription | coupon |
admin | purchase | grade | explanation | tutor | coach | …`). `delta_cents` is the signed
  amount. `ref_id` is a GLOBAL unique idempotency key.
- **`credit_balances`** — one row per user: `balance_cents` (authoritative whole-cent balance,
  may be negative — real), `bag_cents` (off-ledger sub-cent fractional carry), `reference_cents`
  (wallet-gauge anchor — snapshot of balance at the last positive money-in).
- **`credit_charges`** — one row per settled charge, `ref_id` PK — the idempotency claim that
  makes settlement safe to retry.
- **`credit_config`** — admin knobs, no redeploy: `mult.<source>` (×100 billing multiplier),
  `rollover.<source>` (0/1), `expiry_months.<source>` (int N).

**Invariant:** `balance_cents == SUM(credit_ledger.delta_cents)` per user, always. It holds
because the SINGLE WRITER (`api/lib/credit-charge.ts`) mutates the balance row and appends the
ledger row in ONE transaction, always via `INSERT … ON CONFLICT (user_id) DO UPDATE` (never a
bare UPDATE). Raw ledger insert / bare balance UPDATE outside that file is illegal.

**"Allowance" is not a separate currency.** A subscription is a recurring monthly GRANT of
credits (`kind=grant, source=subscription`) into the one ledger, presented as an entitlement.
Coupons and purchases grant the same way. Allowance-vs-purchased is a `source`/`kind` reporting
concern, not two balances.

---

## Cost of a spend — cost-of-goods × multiplier (no fixed price table)

A spend cost is NOT a hardcoded per-action price. It is:

```
rawCents  = costFor(model, usage)          # shared/domain/cost-of-goods.ts — provider cost
owedCents = applyMultiplier(rawCents, mult.<source>)   # × the per-source margin knob
```

The fractional `owedCents` accumulates in `bag_cents`; a whole cent flushes as one negative
`consumption` ledger row + balance decrement (sub-cent charges never round to 0 or 1).

Metering is **delivered-only**: the charge settles AFTER the relay result is re-read
server-side (`api/lib/ai-metering.ts` → `settleDelivered` → `charge()`). An undelivered job
(`status:error`) is never charged — so there is no debit-at-enqueue and no refund rail.

---

## Admission — read the balance, deny at zero (grace)

`api/lib/admission.ts` `admit(userId)` is the SOLE spend-admission path:

- Reads `credit_balances.balance_cents`; admits while **> 0**.
- **Grace-at-zero:** the request that spends the last cent reads a still-positive balance and
  completes; the NEXT request reads `<= 0` and is denied.
- **Fail-CLOSED burst:** on a balance-READ failure, admit at most `BURST=3` actions, then deny
  (a DB blip can't become unbounded free work). A healthy read resets the burst budget.
- **Non-spend door** (`admitNonSpend`): reads/history/config are fail-OPEN — never denied by a
  billing read.

---

## charge-LOST retry — never lose a delivered charge, never double-charge

Some finalize paths persist delivered output BEFORE settlement. So `settleDelivered()` NEVER
throws into the request path: on a `charge()` failure it logs `[credits] charge-LOST … refId=…`
and schedules ONE idempotent background retry, logging `charge-RECOVERED` on success. Because
`charge()` is idempotent by `ref_id` (`credit_charges` PK), the retry can never double-charge —
if the original tx actually committed, the retry is a replay no-op.

---

## Reset — per-source rollover / expiry (config-driven, append-only)

Reset is per-source config, not one global rule (owner directive):

- `rollover.<source>=1` → leftover carries; NO reset entry is ever written.
- `rollover.<source>=0` + `expiry_months.<source>=N` → once the window elapses, ONE append-only
  NEGATIVE `kind=expiry` row (deterministic `ref_id = user:<source>:<period>`) claws back ONLY
  that source's own leftover (`SUM(delta_cents) WHERE source=<source>`, clamped ≥0) — never the
  whole unified balance, so other sources' funds are untouched.

`api/lib/credit-charge.ts` `expire()` is ACTIVE: a scheduled/period caller resolves the knobs
and invokes it. Idempotent by the deterministic ref_id (re-running a period is a no-op).

---

## Wallet fuel gauge — server percent, dumb client

`credits.wallet` returns `{ percent, periodEnd }`. `percent = clamp(round(100 * balance /
reference), 0, 100)` is computed SERVER-side (`shared/domain/credit-money.ts` `walletPercent`).
The client (web `WalletGauge` + mobile chips + both `BillingPage`s) renders a FUEL GAUGE only —
never a raw magnitude (no cents/units reach the client) and never any reset/recompute logic.

---

## Funding paths

- **Coupon** (`credits.redeem`) — the only user-facing top-up until a purchase flow exists.
  Three kinds: `credits` (grant, source=coupon), `allowance` (grant, source=subscription via
  `grantAllowance`), `subscription` (activates a period via `grantSubscription`). Two-rail
  safety: atomic per-coupon cap + per-(coupon,user) replay guard, all in one tx.
- **Subscription** (`grantSubscription`) — recurring monthly grant; period extends forward from
  `max(current_period_end, now)`. Monthly units read from `pricing_config.monthly_allowance_units`.
- **Admin grant** (`grantCredits` / admin `grantAllowance`) — manual top-up.
- **Purchase / IAP** — NOT built yet; plugs in later as another `kind=purchase` writer through
  the same one-writer tx. No new engine work (#57).

No automatic signup grant — it is farmable (delete account → re-register → fresh grant). Coupons
are the only free-credit path.

---

## Business rules (owner, verbatim intent)

- Subscription = recurring monthly GRANT of credits into ONE unified append-only ledger,
  presented as an "allowance" entitlement, reportable like any grant. One balance, one engine.
- Reset: per-source `rollover.<source>` + `expiry_months.<source>`; expiry = append-only negative
  `kind=expiry` row; rollover=true → no reset entry.
- Refund kept as a real-but-DORMANT kind (delivery confirmed at settle → not the normal
  correction path; an undelivered job is simply never charged).
- Every mutation touches ledger + balance in ONE tx in ONE file that is the ONLY writer; balance
  mutation always `INSERT … ON CONFLICT DO UPDATE`, never a bare UPDATE.

---

## Key modules

| Concern                                    | Module                                        |
| ------------------------------------------ | --------------------------------------------- |
| Single writer (charge/grant/refund/expire) | `api/lib/credit-charge.ts`                    |
| Pure money math + wallet percent           | `shared/domain/credit-money.ts`               |
| Cost-of-goods table                        | `shared/domain/cost-of-goods.ts`              |
| Reset policy (rollover/expiry)             | `shared/domain/credit-reset.ts`               |
| Reserved ref_id prefixes                   | `shared/domain/credit-reserved.ts`            |
| Delivered-only settle + charge-LOST retry  | `api/lib/ai-metering.ts`                      |
| Admission (fail-closed burst, grace)       | `api/lib/admission.ts`                        |
| Wallet endpoint + coupon redeem            | `api/trpc/routers/credits.router.ts`          |
| Subscription grant                         | `api/lib/subscription.ts`                     |
| Admin grant                                | `api/lib/credits.ts` / `api/lib/allowance.ts` |

---

## Parked (later, per #57)

- IAP / store purchase grant (server-side pack map keyed by verified productId).
- Admin monetization reports (the unified `source`/`kind` already makes everything reportable).
- Multiplier tuning UI + per-source reset-policy admin UI over the `credit_config` knobs.
