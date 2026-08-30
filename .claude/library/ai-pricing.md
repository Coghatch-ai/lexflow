# How LexFlow prices AI

**Holds when:** any change to what an AI call costs us or charges a user — rate tables, model
swaps, margin knobs, metering.

- A charge is: **real tokens reported by the provider × the price of the model that actually ran ×
  the source's margin multiplier**. Never an estimate, never a hardcoded token count.
- The price table (`shared/domain/cost-of-goods.ts`) holds **TRUE provider cost only**, input and
  output rates separately, in cents per 1M tokens. Decimals are allowed and required where the
  real rate is not a whole cent — rounding a rate is a hidden markup.
- **Margin never lives in the price table.** It lives in `credit_config` as `mult.<source>`
  (×100 integer, `120` = 20%), seeded by `pnpm db:seed-credit-config`, tunable with no redeploy.
  Resolved live by `multiplierFor()` in `api/lib/credit-charge.ts`, applied by `applyMultiplier()`.
- Every rate carries **provenance on its row**: first-party URL · provider page date · retrieval
  date · USD input price · USD output price. A rate without provenance is not allowed in.
- A relay result with **no usage**, or naming a **model with no rate row**, is a **delivery
  failure**: nothing persisted, nothing charged. Never fall back to an estimate.
- Order of operations when rates or margin change: **deploy the code first, seed the multiplier
  second**. The reverse applies the new margin to the old marked-up rate — an overcharge window.

**Watch out:** the multiplier defaults to 1× (`MULT_DEFAULT_X100 = 100`) when a source has no
`mult.<source>` row, so a newly added spend source sells **at cost** until someone seeds it. The
four spend sources today are `grade`, `explanation`, `tutor`, `coach` — the only callers of
`consumeAndCharge` (`api/lib/ai-metering.ts`).
