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
- **Pricing NEVER fails the user's action.** Credit is admitted at the door (`admit()`,
  `balance > 0`) BEFORE the call; the charge happens on the way back. So a result we cannot price
  is **not** a delivery failure. No usage, an invalid counter, no model, or a **model with no rate
  row** ⇒ the output is persisted, the action completes, and the call is charged **0** — recorded
  as `credit_charges.source` ending in **`:unmetered`** and logged with the stable tag
  `[credits] ai usage indisponível — cobrado 0` (once per `refId`; a replay adds neither). The one
  remaining delivery failure is **missing text** (`BAD_GATEWAY`) — nothing was delivered.
  **Never estimate** to fill a gap: 0 is not the price, it is the visible absence of one.
  ⚠ The reverse rule ("no usage ⇒ nothing persisted, nothing charged") was written here before
  and is WRONG — it invented a way for metering to veto a delivered answer.
- **Six surfaces must report usage**, not five: the relay sender (`api/relay/providers.ts` →
  `relay-handler.ts`) AND the streaming sender (`api/stream/stream-providers.ts` →
  `stream-handler.ts`, the tutor with `stream:true`). Both write the SAME result shape
  `{ text, model, usage }` to `results/{userId}/{jobId}.json`; `parseAiResult`
  (`api/lib/ai-metering.ts`) is the single reader. A sender never throws over usage.
- The **charged model comes from the result read server-side**, never from a tRPC input. `grade`
  lets the client pick provider/model for the CALL; letting that reach the charge would be a
  free-call lever now that an unpriceable call costs 0.
- **The provider echoes a SNAPSHOT, not the alias the table is keyed by** — OpenAI answers with a
  dated snapshot (`gpt-4o-mini-2024-07-18`), Gemini with a `modelVersion` revision
  (`gemini-3.6-flash-002`). Pricing therefore RESOLVES the echoed id: `resolveRateModel()` strips
  ONE documented version suffix (`-YYYY-MM-DD` or `-NNN`) and looks the base up EXACTLY. It never
  prefix-matches — `gpt-4o-realtime` must not inherit the `gpt-4o` rate. An id that still resolves
  to nothing keeps the visible `:unmetered` + 0¢ + log behaviour; resolution never guesses.
  (An exact-key lookup here is what made round 1 of #98 bill **0 on all live traffic**.)
- **What a CLIENT may REQUEST is an EXACT key of `COST_OF_GOODS`** (`isRequestableModel` =
  `Object.hasOwn`, enforced by `requestedModelSchema` in `ai.router.ts` at tRPC input validation,
  before `admit()` and before the outbox). Otherwise "ask for an un-priced model" = free inference:
  real delivered work, charged 0 by design. **The suffix strip of the bullet above is METERING-ONLY
  and must never govern client input** — a client sending `gpt-4o-2024-05-13` would otherwise
  validate and settle at `gpt-4o`'s rate, i.e. one model billed at another's price, with no
  provenance for the id that ran (#98 review round 2). Two doors, two questions: metering asks
  "what row prices the id the PROVIDER echoed?", the request door asks "is this client string
  literally a priced row?". This constrains the REQUEST side only — the SSM-selected model is never
  gated this way, because metering may never veto a delivered call.
- **The poll endpoint returns `{ text }` only** (`clientRelayJobView` in `api/lib/relay.ts`). The
  senders write `{ text, model, usage }` for SERVER-side pricing; the doors read `getRelayJob()`
  directly, so the browser never needs the metering facts.
- Order of operations when rates or margin change: **deploy the code first, seed the multiplier
  second** (`pnpm db:seed-credit-config`). The reverse applies the new margin to the old marked-up
  rate — an overcharge window.

**SSM picks the live model, not the code default.** Checked 2026-08-30:
`/lexflow/relay/prod/ai-provider` = `openai`, `/openai-model` = **`gpt-5.4-mini`**, `/ai-model` =
`gemini-3.1-flash-lite`. A rate row for the code default therefore proves nothing — always read
the parameters (`aws ssm get-parameter`) before believing a model is priced. `gpt-5.4-mini` has
**no first-party verified price** in `.claude/library/verdicts/`, so it is deliberately absent
from the table (a rate without provenance is not allowed in): until a verified row lands or the
parameter points at a priced model, prod OpenAI calls settle as `no-rate-row` ⇒ **0**, logged,
`source` `…:unmetered`.

**Adoption is explicit, and a rate row is adopted — not merely verified.** A verdict file
confirming a price is NOT permission to bill it; the row enters `COST_OF_GOODS` only by decision,
and the verdict records that it was adopted (see `## Adoption status` in
`.claude/library/verdicts/ai-price-verification-2026-08-29.md`). Adopted 2026-08-30 by human
decision (#98 review round 1): **`gpt-5.6-luna` = 20¢/1M in · 120¢/1M out** (verdict line 27), now
also the OpenAI **code default** in `relay-handler.ts` + `stream-handler.ts` (off `gpt-4o-mini`).
**Still pending, a HUMAN ops step after deploy:** repoint `/lexflow/relay/prod/openai-model` at
`gpt-5.6-luna`. Until that happens SSM still selects `gpt-5.4-mini` and prod OpenAI calls keep
settling at a visible 0.

**Not modelled (deliberate, documented in `cost-of-goods.ts`):** OpenAI long-context (>272K ⇒ 2×
input / 1.5× output), Gemini >200K tiers, Gemini audio/video input tiers, and the 2027-01-01
`gemini-3.6/3.7-flash` increase. A call over one of those thresholds **under**-charges.

**Watch out:** the multiplier defaults to 1× (`MULT_DEFAULT_X100 = 100`) when a source has no
`mult.<source>` row, so a newly added spend source sells **at cost** until someone seeds it. The
four spend sources today are `grade`, `explanation`, `tutor`, `coach` — the only callers of
`consumeAndCharge` (`api/lib/ai-metering.ts`). The `:unmetered` suffix never matches a
`mult.<source>` row, so an unpriced charge is `0 × 1 = 0` — harmless, and the reason the suffix
goes on `source` only, never on `refId` (idempotency identity must not change).
