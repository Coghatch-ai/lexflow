# Codex adversarial review of the port findings (verdict)

Codex session `019fa997-d0c2-7b32-aa32-e269e4f1e429`. Verdict: **findings substantially
correct, target architecture sound; D1–D5 under-specifies LIVE MIGRATION + monthly-reset —
those are where accounting drift / double-charge would come from.** The designer MUST fold the
items below into the D1–D5 PRD.

## Confirmed

- Debit-at-admission is real: `ai.router.ts:95/100/104` (assert→debit→enqueue), `:163`
  (debitCredits before tutor enqueue), `questions.router.ts:270` (allowance debit before
  explanation enqueue).
- Lost/stuck relay risk is real: refund fires ONLY when polling sees `status==="error"`
  (`relay.router.ts:27`). A job durably debited, enqueued, then lost / stuck pending / never
  polled / never → `error` = **no auto-refund, user charged for nothing.**
- No materialized tables: balance is `SUM(delta)` (`credits.ts:20`); `credit_balances`,
  `credit_charges`, `bag_cents`, `reference_cents` exist only in the research doc, not in
  `schema-ai.ts`.

## Correction to fold in

- Stale comments in `credits.ts:7` and `allowance.ts:7` say _enqueue-before-debit_, but the
  routers/tests are _debit-before-enqueue_. Call out and fix this comment/code inconsistency.

## Monthly allowance reset — MUST be defined before D2 (load-bearing for the invariant)

Subscription-as-recurring-grant preserves `balance_cents == SUM(delta)` **only if** every grant,
purchase, coupon, consumption, expiry, adjustment goes through the one-writer tx that mutates
ledger + `credit_balances`. Reset options:

- **Rollover** (leftover carries): no reset entry; next monthly grant just adds balance.
- **Expire** (leftover lost): expiry MUST be an append-only NEGATIVE ledger row
  (`kind=expiry|adjustment`) with deterministic `ref_id=user:period`, same tx updates
  `credit_balances`. Never delete/rewrite old grant rows, never bare-update balance.
- **Clawback**: mechanically = expiry; a product decision.
  Risk: current allowance rail already mentions `rollover`/`expire`; porting that blindly into one
  ledger can recreate two currencies or break append-only accounting. **Decide before D2.**
  Refund stays dormant — do NOT make it the normal correction path once delivered-only lands.

## Live-migration gaps to add (the main weakness)

D1 must also:

- Backfill `credit_balances` from existing derived balances before any shadow traffic.
- Merge `credit_ledger` + `allowance_ledger` into one canonical `credit_ledger` with source map:
  old credits → `source=purchase|coupon|admin|legacy`; old allowance monthly grants →
  `source=subscription`; old allowance spends → `source=legacy_allowance_consumption`.
- Validate the invariant after backfill (per-user materialized balance == migrated ledger sum).
- Add a dual-read / shadow-compare job before any enforcement.

D2 double-grant hazard: if old allowance paths stay active, subscription grants can double.
Require cutover idempotency keys + a rule: old rails frozen read-only, OR dual-write with
reconciliation and no user-visible enforcement yet.

D3 safe cutover sequence (do NOT just "move call sites"):

1. Old system stays authoritative for admission.
2. New `charge(…, shadow)` observes delivered results, writes nothing.
3. Compare would-charge vs old debits (reconciliation metrics per source/model/action).
4. Only then make the new balance admission authoritative.
5. Then remove old debit-at-admission.

D5 ordering fix: `charge-LOST` retry must exist BEFORE enforce (not after). Shadow-only is fine
without it, but once real post-delivery charging is authoritative, missing retry = uncharged
delivered work.

## Concrete gaps checklist (designer to place across D1–D5)

- Explicit legacy two-rail → one-ledger migration plan.
- Explicit monthly rollover/expiry rule (append-only, deterministic ref_id).
- No-double-charge cutover plan (ref_id/job-id idempotency across old+new).
- Shadow reconciliation metrics: old debit vs would-charge per source/model/action.
- Backfill validation + rollback plan.
- One-writer enforcement: raw `db.insert(creditLedger)` illegal outside the money core after D1/D2.
- Stuck-job remediation for the CURRENT system (or documented acceptance until the port lands).
