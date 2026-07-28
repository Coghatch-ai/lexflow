# Monetization foundation port — D1–D4 (tech-only refactor of a LIVE system)

**Goal** — Replace our debit-at-admission / fixed-price-table money core (Maggie v1, the thing #57 §10 says NOT to port) with the canonical delivered-only metered cents engine (#57 / Maggie #218), migrating a live ledger with zero double-charge, shipped in `CREDITS_MODE=shadow` before enforce.

This is a **design doc only** — no product code. Builders implement each slice.

## Target model (few lines)

- One unified append-only `credit_ledger` (signed `delta_cents`, kind grant/purchase/refund/consumption/adjustment/**expiry**, open-string `source`, unique `ref_id`). Balance is MATERIALIZED (`credit_balances`, 1:1) with a fractional `bag_cents numeric(12,4)` and a `reference_cents` gauge anchor. Idempotent attribution in `credit_charges` (`ref_id` PK). Live int knobs in `credit_config` (`mult.<source>`, plus the reset-policy knobs below).
- **Invariant:** `balance_cents == SUM(credit_ledger.delta_cents)` per user; every mutation touches ledger + balance in ONE transaction in ONE file that is the ONLY writer; bag is off-ledger. Balance mutation is always `INSERT … ON CONFLICT DO UPDATE`, never a bare UPDATE.
- **Subscription = recurring monthly GRANT** (`kind=grant, source=subscription`) into that one ledger, presented to the user as an "allowance" entitlement, reportable like any grant. Coupons + purchases grant the same way. **One balance, one engine** — allowance-vs-purchased is a `source`/`kind` reporting concern, not two balances.
- **Refund** kept as a real-but-**DORMANT** kind (delivery confirmed here → refund is not the normal correction path).
- `charge(scope, source, rawCents, refId, delivered, dryRun)` in one tx: `delivered:false` = universal no-op; `dryRun` = shadow (writes nothing); idempotency via `INSERT credit_charges … ON CONFLICT DO NOTHING RETURNING` (replay → bag does NOT re-accumulate); `floor(bag)<1` → no ledger row. Admission = balance READ, deny `<=0`, fail-CLOSED with `burstAdmit` (BURST=3).

## Owner's reset decision — VERBATIM (authoritative, do not re-litigate)

> "we need a flag to decide if rollover or not. because I want a way to have type of credits that may rollover and may not — one month only. some credits dont expire, some rollover, but this is a business decision we need to have flexibility, right? like easily decide how many months and if rollover, if false. expire"

**Interpretation (bindable):** reset policy is **NOT one global rule**. It is a **per-source, config-driven policy** carried in `credit_config`: for each grant `source`, two knobs — `rollover.<source>` (bool: leftover carries) and `expiry_months.<source>` (int: N months until unused grant expires; 0/absent = never expires). When a grant's window elapses and `rollover=false`, the leftover **expires** via an **append-only NEGATIVE ledger row** (`kind=expiry`, deterministic `ref_id=user:<source>:<period>`) in the same one-writer tx that updates `credit_balances` — never a delete/rewrite/bare-update of old grant rows. When `rollover=true`, **no reset entry** at all (next grant just adds). This keeps append-only accounting intact for every policy the owner picks by config, no code change.

## Slice count — RECOMMEND **4** (not 5)

Original sketch had D1–D5. Collapse **findings-D4 (wallet gauge) + findings-D5 (enforce flip)** into one final slice **D4**: the gauge read is small (one server `percent` + `reference_cents` anchor + chip/BillingPage swap) and the enforce flip is a config change gated on the shadow-reconciliation the slice already runs — they share the same "make new balance authoritative + verify from real traffic" step and verify together in one look. D1–D3 stay separate because each carries a distinct migration/cutover safety gate (backfill+merge; unified-ledger-write cutover idempotency; call-site shadow reconciliation) that must be verified on its own before the next begins. Result: **D1 schema+engine+migration → D2 grant/coupon rails on one ledger + reset policy → D3 call-site charge() shadow+reconcile → D4 wallet gauge + fail-closed/charge-LOST + enforce flip.** Four slices, each one builder / one verify / one human look.

---

## D1 — Materialized schema + pure money math + dormant `charge()` + LIVE backfill/merge

**Domain:** DB schema + money-core lib (`drizzle/schema-ai.ts`, `api/lib/credits.ts`, `ledger-debit.ts`, `shared/domain/credits.ts`) + migration.

**Scope (in):**

- Add `credit_balances` (`balance_cents` int, `bag_cents numeric(12,4)`, `reference_cents` int, 1:1 user), `credit_charges` (`ref_id` PK), `credit_config` (`key→value_int`); keep/extend `credit_ledger` with `kind=expiry` + open-string `source` + unique `ref_id`.
- Pure money math (no I/O): `applyMultiplier(raw, multX100)` fractional never rounded, clamp mult [0,10000], cap rawCents; `flushBag(bag,owed)→{floor flush, remainder}`.
- `charge()` engine + `delivered`/`dryRun` params, shipped **DORMANT** (no call site invokes it yet). One-writer tx: ledger+balance in one INSERT…ON CONFLICT DO UPDATE.
- **LIVE migration (Codex):** backfill `credit_balances` from current derived `SUM(delta)` before any traffic; **merge `credit_ledger` + `allowance_ledger` into one canonical `credit_ledger`** with source map — old credits → `source=purchase|coupon|admin|legacy`; old allowance monthly grants → `source=subscription`; old allowance spends → `source=legacy_allowance_consumption`. Validate invariant post-backfill (per-user materialized balance == migrated ledger sum). Add rollback plan.
- Fix stale comments `credits.ts:7` + `allowance.ts:7` ("enqueue-before-debit" → routers are debit-before-enqueue).

**Acceptance (maps #57):**

- Invariant property test `balance_cents == SUM(delta)` per user, **incl. a user whose FIRST write is a charge** (first-write-is-a-charge).
- Replay: second `charge()` with same `ref_id` = no-op, bag does NOT re-accumulate (replay no-op).
- Sub-cent: `floor(bag)<1` → NO ledger row (sub-cent no ledger row).
- Bag crossing 1¢: accumulated bag ≥1 → exactly one `consumption` row flushed, remainder retained (bag-crossing-1¢ flush).
- Balance mutation is `INSERT … ON CONFLICT DO UPDATE`, never bare UPDATE (grep guard).
- **Migration gate:** post-backfill per-user `credit_balances.balance_cents == SUM(merged credit_ledger.delta_cents)` for every existing user (backfill validation).
- Rollback documented + reversible. `[human check]` migration dry-run on a DB snapshot before prod apply.

**Safety gates here:** backfill BEFORE any shadow traffic; invariant validation post-backfill; rollback plan. (Codex §"Live-migration gaps" all land in D1.)

---

## D2 — Grant/coupon rails on the unified ledger + reset policy + one-writer enforcement

**Domain:** funding rails + config (`api/lib/allowance.ts`, `subscription.ts`, `credits.ts`, `credits.router.ts`).

**Scope (in):**

- Route subscription monthly grant, coupon redeem, purchase-pack, admin grant ALL through the D1 one-writer tx as `kind=grant/purchase`, correct `source`. Allowance READS become a view over the unified ledger (no separate balance).
- **Reset policy (owner's decision):** `credit_config` knobs `rollover.<source>` (bool) + `expiry_months.<source>` (int). Expiry job appends NEGATIVE `kind=expiry` row, deterministic `ref_id=user:<source>:<period>`, same one-writer tx; `rollover=true` → no reset entry. Retire the current `allowance.ts:249` `rollover` action (two-currency risk).
- Demote `refund` to a dormant kind/flag (present, not the correction path).
- **One-writer enforcement (Codex):** raw `db.insert(creditLedger)` is ILLEGAL outside the money core after this slice — remove the raw grant/refund inserts (`credits.ts:67/:89`), the allowance/coupon direct writers.
- **No-double-charge cutover (Codex):** old allowance rails frozen read-only OR dual-write with reconciliation + no user-visible enforcement; cutover idempotency keys so a subscription grant can't double.

**Acceptance:**

- Expiry replay: running the expiry job twice for the same `user:source:period` inserts exactly one `kind=expiry` row (deterministic ref_id idempotency).
- `rollover.<source>=true` → no expiry row appears; `rollover=false, expiry_months=N` → negative row appears exactly at month N boundary, balance drops by the leftover, invariant holds.
- After slice: grep proves NO raw `db.insert(creditLedger)` / `insert(allowanceLedger)` outside the money core (one-writer guard).
- Subscription grant applied twice with same period key = one grant, no double (double-grant guard).
- Invariant still holds after a full grant→consume→expire cycle.

**Safety gates here:** reset policy DEFINED + config-driven before any expiry runs; two-rail freeze/dual-write; double-grant idempotency. (Codex "decide reset before D2" satisfied by owner decision above.)

---

## D3 — Move AI call sites to delivered-only `charge()` in SHADOW + cost-of-goods + reconcile

**Domain:** AI call sites + cost table (`ai.router.ts`, `questions.router.ts`, `admin.router.ts`, new cost-of-goods table + `costFor`).

**Scope (in):**

- Move grade / explanation / tutor / coach spends to **admission-read + POST-delivery `charge()`**, running in `CREDITS_MODE=shadow` (dryRun, never denies). Old debit-at-admission STAYS authoritative this slice.
- Add cost-of-goods table (SEPARATE from billing multiplier) + `costFor(model,usage)` (unknown model → 0, never throws) + per-model-rate guard.
- Retire the fixed price table (`CREDIT_COSTS`, `ALLOWANCE_COST`) once shadow proves parity — but only wire the NEW path; removal of old debit is D3's last step behind the reconcile gate.
- Meter `admin.generateExplanation` (currently unmetered).
- **Safe cutover sequence (Codex, exact order):** (1) old system authoritative; (2) new `charge(…, shadow)` observes delivered results, writes nothing; (3) reconcile would-charge vs old debits — metrics per source/model/action; (4) THEN new balance admission authoritative; (5) THEN remove old debit-at-admission.

**Acceptance:**

- Shadow zero-rows: in `CREDITS_MODE=shadow`, `charge()` writes NO ledger/charge/balance rows (shadow zero-rows).
- `delivered:false` → `charge()` is a total no-op, no tx (delivered:false no-op).
- Model-rate guard: test asserts every model id in live use has a cost-of-goods rate row (model-rate-row guard).
- Reconciliation metric emitted per source/model/action (would-charge vs old debit) — `[human check]` parity acceptable before flip.
- `costFor(unknownModel)` returns 0, does not throw.

**Safety gates here:** shadow-first; reconciliation BEFORE authoritative; old debit removed LAST. (Codex D3 sequence.)

---

## D4 — Wallet gauge + fail-closed burst + charge-LOST retry + ENFORCE flip

**Domain:** wallet read + admission + frontend gauge + `CREDITS_MODE` (`credits.router.ts`, `allowance.ts`, `BillingPage.tsx`, chips + mobile mirrors).

**Scope (in):**

- Wallet read: `reference_cents` snapshotted at last positive money-in (grant/purchase only); `percent = clamp(balance/reference,0,100)` computed SERVER-side. Client renders a fuel gauge, never a raw magnitude, never recomputes reset logic. Swap `AllowanceChip`/`CreditsChip`/`BillingPage` (web + mobile) to the gauge.
- Admission fail-CLOSED with `burstAdmit` (BURST=3) on read failure; deny `<=0` with grace (last cent completes, next denied); separate fail-OPEN door for non-spend actions.
- **`charge-LOST` retry (Codex — MUST exist BEFORE enforce):** caller `charge()` never throws into request path; logs `[credits] charge-LOST … refId=…`; schedules ONE idempotent background retry; logs `charge-RECOVERED`.
- **Flip `CREDITS_MODE` to enforce** (config change) — gated on D3 reconciliation parity + this slice's charge-LOST retry existing.
- Reconcile `docs/monetization.md` as single source of truth (drop maggie#206 cite → #218/#57).

**Acceptance:**

- Fail-closed burst: on balance-read failure, first BURST=3 admissions allowed, then denied (fail-closed burst).
- charge-LOST: a `charge()` that fails post-delivery logs `charge-LOST`, background retry is idempotent (same `ref_id`), logs `charge-RECOVERED` (charge-LOST).
- Grace: balance hits exactly 0 mid-action → that action completes, NEXT admission denied.
- Wallet endpoint returns server `percent` [0,100] + no dollar figure; client has no reset/recompute logic. `[human check]` gauge renders (web + mobile).
- `CREDITS_MODE` unset=enforce, `shadow`=dryRun+never-deny, `off`=skip — one guard test per mode.

**Safety gates here:** charge-LOST retry EXISTS before enforce flip; enforce gated on D3 reconcile parity. (Codex D5 ordering fix.)

---

## Business rules / product facts — verbatim

- Subscription = recurring monthly GRANT of credits into ONE unified append-only ledger (`kind=grant, source=subscription`), presented as an "allowance" entitlement, reportable like any grant. Coupons + purchases grant the same way. One balance, one engine — allowance-vs-purchased is a `source`/`kind` reporting concern, not two balances. (owner, findings.md §"Owner's confirmed business model")
- **Reset (owner, verbatim):** "we need a flag to decide if rollover or not… some credits dont expire, some rollover… like easily decide how many months and if rollover, if false. expire." → per-source config knobs `rollover.<source>` + `expiry_months.<source>`; expiry = append-only negative `kind=expiry` row, deterministic `ref_id=user:<source>:<period>`; rollover=true → no reset entry.
- Refund kept as a real-but-DORMANT kind (delivery confirmed here → not the normal correction path).
- Every mutation touches ledger + balance in ONE tx in ONE file that is the ONLY writer; raw `db.insert(creditLedger)` illegal outside the money core after D1/D2; balance mutation always INSERT…ON CONFLICT DO UPDATE, never bare UPDATE.

## Skill notes (project conventions that apply)

- LOV/picklist: any new source/kind enum → English code, pt-BR label; use `pnpm db:seed-lov` for label changes, NOT `db:seed` (docs/conventions.md).
- Business rules live in `shared/` (money math already targeted there). No duplication.
- Migrations: `db:generate` → review SQL → `db:migrate`; NEVER apply SQL to RDS by hand, never `db:push`. Add a `TABLE_SCOPE` entry for each new user-owned table (`credit_balances`, `credit_charges`) in `api/db/scope.ts`.
- No `console.log` (warn/error only), no `any`, no non-null `!`. No dep add/remove without approval.
- Deploy via GitHub Actions only; this is a LIVE prod DB — every migration dry-run on a snapshot first.

## Applied recommendations

| Decision                    | What applied                                                                                               | Why                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slice count                 | 4, not 5                                                                                                   | Wallet gauge (small) + enforce flip (config, gated on D3 reconcile) share one "make new balance authoritative + verify from real traffic" step → collapse. D1–D3 each carry a distinct migration gate → stay separate. |
| Reset policy shape          | Per-source `credit_config` knobs (`rollover.<source>`, `expiry_months.<source>`), not a single global rule | Direct from owner's verbatim answer — wants config-driven flexibility, not one hardcoded rule. Preserves append-only for every policy.                                                                                 |
| Expiry mechanism            | Append-only negative `kind=expiry` row, deterministic `ref_id=user:<source>:<period>`                      | Codex requirement — never delete/rewrite/bare-update; only way to keep the invariant under expire.                                                                                                                     |
| Codex migration gates → D1  | Backfill + two-rail merge + invariant validation + rollback all in D1                                      | These block the very first shadow traffic; must be verified before D2 can write.                                                                                                                                       |
| Codex D3 sequence           | Old authoritative → shadow observe → reconcile → flip → remove old, in that order                          | Prevents double-charge / accounting drift during cutover.                                                                                                                                                              |
| charge-LOST retry placement | D4, BEFORE the enforce flip in the same slice                                                              | Codex ordering fix — once real charging is authoritative, missing retry = uncharged delivered work.                                                                                                                    |
| Refund                      | Demoted to dormant kind in D2                                                                              | Owner: delivery confirmed here, refund not the correction path.                                                                                                                                                        |

## Not in scope (rails plug in later, per #57)

- **IAP / store purchase grant** (server-side pack map keyed by verified productId). #57 §"Funding" — plugs in as another `kind=purchase, source=iap` writer through the same D1 one-writer tx. No new engine work.
- **Admin monetization reports** — the unified ledger's `source`/`kind` already makes every grant/spend reportable; report UI is a later read-only slice.
- **Stuck-job remediation for the CURRENT system** (Codex): the lost/stuck-relay-job-debits-with-no-refund class. Delivered-only charging (D3) DELETES this class, so no separate remediation is built — documented acceptance until D3 lands. (If prod bleeds before D3, a one-off reconcile script is a fast-follow, not a slice.)

## Later (parked)

- Auto-signup grant — deliberately NOT built (farmable), per #57.
- Multiplier tuning UI over `credit_config` (`mult.<source>`) — knobs exist from D1, admin UI later.
- Per-source reset-policy admin UI over the `rollover.<source>`/`expiry_months.<source>` knobs.

## Open questions

None blocking. Reset decision resolved by owner. Proceed to implementation on D1.
