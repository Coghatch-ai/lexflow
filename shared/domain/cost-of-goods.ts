// shared/domain/cost-of-goods.ts
//
// COST-OF-GOODS table + costFor() for the unified credit engine (D3, epic #50).
//
// This is the raw, pre-multiplier COST of an AI call in cents — the `rawCents`
// argument to charge(). It is DELIBERATELY SEPARATE from the billing multiplier
// (`mult.<source>` in credit_config): cost-of-goods is what the provider charges
// US per token; the multiplier is the margin/markup applied on top at charge
// time. Two different knobs, two different owners — never conflate them.
//
// TRUE PROVIDER COST ONLY (#98). The old rows had a ~20% margin welded into a
// single BLENDED per-token rate; margin now lives exclusively in credit_config
// as `mult.<source>` (seeded by `pnpm db:seed-credit-config`, AFTER deploy).
//
// RATES are CENTS PER 1,000,000 TOKENS, split INPUT and OUTPUT (the shape every
// provider actually quotes). Decimals are allowed and required where the real
// rate is not a whole cent — rounding a rate is a hidden markup.
//
// PROVENANCE is mandatory on every row: first-party URL · provider page date ·
// retrieval date · USD input price · USD output price. A rate without
// provenance is not allowed in. Source of the current rows:
// `.claude/library/verdicts/ai-price-verification-2026-08-29.md`.
//
// ── LIMITS NOT MODELLED (explicit decision, #98 — not an oversight) ──────────
// A call that crosses one of these thresholds is UNDER-charged; none is modelled
// here today and none may be silently "estimated":
//   - OpenAI long context: prompts >272K input tokens bill at 2x input / 1.5x
//     output for the full request (source: the gpt-5.6-* model pages, NOT the
//     pricing page).
//   - Gemini >200K-context tiers (e.g. gemini-3.1-pro-preview, gemini-2.5-pro
//     roughly double above 200K).
//   - Gemini audio/video input tiers (audio input is priced above text on the
//     flash-lite / 2.5-flash rows; omni video bills per 720p second).
//   - The 2027-01-01 Gemini 3.6/3.7-flash increase (75→150 in, 375→750 out).
// Reasoning / "thinking" tokens are NOT a limit: both providers bill them as
// OUTPUT tokens, and the metering path counts them in `outputTokens`.
//
// INVARIANT: costFor NEVER throws and NEVER returns a negative/non-finite value.
// An unknown model or a garbage counter collapses to 0 — a missing rate must
// fail OPEN to zero cost, never crash a delivered request. Zero-cost is NOT
// silent: the caller (`parseAiResult` → `consumeAndCharge`) records an
// `unpriced` charge with a `:unmetered` source suffix + a console.error. The
// per-model-rate GUARD test asserts every id in LIVE_MODEL_IDS has a rate row.

/** Tokens actually reported by the provider for one call. Reasoning/thinking
 *  tokens are counted as OUTPUT (both providers bill them that way). */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A model's cost-of-goods rate: cents per 1,000,000 tokens, input and output
 *  quoted separately. Decimals allowed (rounding a rate is a hidden markup). */
export interface ModelRate {
  readonly input: number;
  readonly output: number;
}

/** Scale factor: rates are quoted per 1,000,000 tokens. */
const RATE_UNIT = 1_000_000;

// ─── The cost-of-goods table ────────────────────────────────────────────────
//
// TRUE provider cost, cents per 1M tokens, input/output split. Every id here
// MUST appear in LIVE_MODEL_IDS (and vice-versa) — the guard test enforces the
// round-trip so a newly-routed model can never meter at 0 unnoticed.
export const COST_OF_GOODS: Readonly<Record<string, ModelRate>> = {
  // OpenAI — https://developers.openai.com/api/docs/pricing · page shows no
  // last-updated date · retrieved 2026-08-30 · US$0.15/1M in · US$0.60/1M out.
  "gpt-4o-mini": { input: 15, output: 60 },
  // OpenAI — https://developers.openai.com/api/docs/pricing · page shows no
  // last-updated date · retrieved 2026-08-30 · US$2.50/1M in · US$10.00/1M out.
  "gpt-4o": { input: 250, output: 1000 },
  // Google — https://ai.google.dev/gemini-api/docs/pricing · page last updated
  // 2026-08-28 UTC · retrieved 2026-08-30 · US$0.75/1M in · US$3.75/1M out.
  // Official replacement for gemini-2.0-flash (shut down 2026-06-01, see
  // https://ai.google.dev/gemini-api/docs/deprecations).
  "gemini-3.6-flash": { input: 75, output: 375 },
  // Google — https://ai.google.dev/gemini-api/docs/pricing · page last updated
  // 2026-08-28 UTC · retrieved 2026-08-30 · US$0.25/1M in (text/image/video) ·
  // US$1.50/1M out. LIVE: this is what SSM /lexflow/relay/prod/ai-model holds,
  // so it runs whenever the provider is gemini. The AUDIO input tier
  // (US$0.50/1M) is one of the tiers this table deliberately does not model.
  "gemini-3.1-flash-lite": { input: 25, output: 150 },
  // ADOPTED 2026-08-30 (human decision, #98 review round 1) from
  // `.claude/library/verdicts/ai-price-verification-2026-08-29.md:27`, where the
  // row is first-party CONFIRMED. LIVE: the code default for the openai provider
  // in BOTH handlers. Its LONG-context tier (>272K in ⇒ US$0.40/1M in ·
  // US$1.80/1M out) is one of the tiers this table deliberately does not model.
  // OpenAI — https://developers.openai.com/api/docs/pricing · page shows no
  // last-updated date · retrieved 2026-08-30 · US$0.20/1M in · US$1.20/1M out.
  "gpt-5.6-luna": { input: 20, output: 120 },
};

// The model ids that can appear in LIVE traffic — the relay/stream handler
// defaults, whatever SSM currently selects, plus any model a call site passes
// through. The guard test asserts each resolves to a rate row so a live call is
// never metered at 0.
//
// ⚠ SSM OVERRIDES THE CODE DEFAULT. Checked 2026-08-30:
// /lexflow/relay/prod/ai-provider = "openai", /openai-model = "gpt-5.4-mini",
// /ai-model = "gemini-3.1-flash-lite". `gpt-5.4-mini` has NO first-party price
// verified in .claude/library/verdicts/ — so it is deliberately ABSENT here
// rather than guessed: a rate without provenance is not allowed in. The code
// default is now `gpt-5.6-luna` (priced, verified), but the SSM parameter still
// wins at runtime: pointing /openai-model at `gpt-5.6-luna` is a HUMAN ops step
// AFTER this deploys. Until it happens, every prod OpenAI call lands as
// `no-rate-row` ⇒ charged 0, logged, `source` `…:unmetered`.
//
// RETIRED and deliberately absent (never re-add without a fresh price check):
// gemini-2.0-flash (shut down 2026-06-01), gemini-1.5-flash, gemini-1.5-pro.
export const LIVE_MODEL_IDS: readonly string[] = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-5.6-luna",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
];

/** Model ids retired from the table — the guard test asserts none comes back. */
export const RETIRED_MODEL_IDS: readonly string[] = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

// ─── Echoed-id → rate-row resolution (#98 review round 1) ───────────────────
//
// THE ROW KEYS ARE ALIASES; THE PROVIDERS ECHO A SNAPSHOT. What reaches pricing
// is the id the provider reported back (`echoedModel`), which is NOT the alias
// that was requested:
//   - OpenAI Responses API echoes the DATED SNAPSHOT: `gpt-4o-mini-2024-07-18`.
//   - Gemini echoes `modelVersion`, an alias plus a 3-digit revision:
//     `gemini-3.6-flash-002`.
// An exact-key lookup therefore missed on essentially all live traffic ⇒
// `no-rate-row` ⇒ every call charged 0. That was the round-1 blocker.
//
// THE RULE: strip ONE trailing suffix whose SHAPE is a documented version marker
// of the SAME model, then look the base up EXACTLY. Nothing else is attempted.
//   - `-YYYY-MM-DD`  OpenAI dated snapshot
//   - `-NNN`         Gemini modelVersion revision (3 digits)
//
// WHY NOT LONGEST-PREFIX MATCHING (the obvious alternative — rejected): a prefix
// match makes a DIFFERENT model inherit a neighbour's rate. `gpt-4o-realtime`
// would silently bill at the `gpt-4o` rate; a future `gemini-3.6-flash-thinking`
// would bill at the non-thinking rate. Wrong money, invisibly. The suffix rule
// can only ever collapse a revision of one model onto that same model, and a
// NEW variant name simply fails to resolve.
//
// A FAILED RESOLUTION IS NOT A GUESS. It stays exactly as before: `hasCostRate`
// false ⇒ `parseAiResult` returns `unpriced`/`no-rate-row` ⇒ the delivered call
// is charged 0 under a `:unmetered` source and logged. Visible, never invented.
//
// NOT COVERED (documented, deliberately unresolved — they fall through to the
// visible 0): a `-preview`/`-latest`/`-exp` style suffix, a date suffix without
// dashes, or any provider that starts echoing a wholly different id shape.
const SNAPSHOT_SUFFIX = /-(?:\d{4}-\d{2}-\d{2}|\d{3})$/;

/**
 * The rate-table key `model` should be priced under, or null when there is none.
 * Returns `model` itself when it is already a table key; otherwise strips ONE
 * documented snapshot/version suffix and retries the EXACT lookup. Pure, total,
 * never throws, never prefix-matches.
 */
export function resolveRateModel(model: string): string | null {
  if (COST_OF_GOODS[model] !== undefined) return model;
  const base = model.replace(SNAPSHOT_SUFFIX, "");
  return base !== model && COST_OF_GOODS[base] !== undefined ? base : null;
}

/**
 * Raw (pre-multiplier) cost in cents for `usage` of `model`. TOTAL + PURE:
 *   - snapshot/versioned id     → priced at its base row (resolveRateModel)
 *   - unknown model             → 0 (fail-open, never throw)
 *   - non-finite / negative cnt → that side contributes 0 (clamped)
 * The result is fractional (sub-cent) on purpose — charge()'s bag carries the
 * remainder. Never negative, never non-finite.
 */
export function costFor(model: string, usage: Usage): number {
  const key = resolveRateModel(model);
  const rate = key === null ? undefined : COST_OF_GOODS[key];
  if (rate === undefined) return 0;
  return (
    (clamp(usage.inputTokens) * rate.input + clamp(usage.outputTokens) * rate.output) / RATE_UNIT
  );
}

/** Non-finite / negative token counts contribute nothing (never a credit). */
function clamp(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
}

/** True when `model` resolves to a cost-of-goods rate row — directly or through
 *  its snapshot/version suffix (the metering door's gate: a model with no row is
 *  `unpriced`/`no-rate-row`, charged 0 and logged). */
export function hasCostRate(model: string): boolean {
  return resolveRateModel(model) !== null;
}

/**
 * May a CLIENT ask for this model? (#98 review round 1 finding 2; TIGHTENED in
 * review round 2, blocker 1.)
 *
 * `ai.grade` lets the caller override provider/model for the CALL. Since an
 * unpriceable delivered call is charged 0 BY DESIGN, an unconstrained string
 * there is a free-inference lever: a signed-in user asks for an expensive
 * un-priced id, gets the real completion, and is billed 0. So the request side
 * is an ALLOWLIST, enforced at the tRPC input, BEFORE admission and before the
 * job ever reaches a provider.
 *
 * THE ALLOWLIST IS EXACT MEMBERSHIP OF THE TABLE — NOT `hasCostRate`. Those two
 * are different questions and round 1 wrongly answered both with one function:
 *   - METERING asks "what row prices the id the provider ECHOED BACK?" — a
 *     question about an id we did not choose, which legitimately arrives as a
 *     snapshot (`gpt-4o-mini-2024-07-18`). Suffix stripping exists for THAT.
 *   - REQUEST asks "may this client-supplied string be sent to a provider?" —
 *     and there, suffix stripping BILLS ONE MODEL AT ANOTHER'S RATE:
 *     `gpt-4o-2024-05-13` is a distinct snapshot with its own real price, has
 *     no line in the verdict file, yet resolved to `gpt-4o` and would settle at
 *     `gpt-4o`'s rate. That breaks this file's own rule (a rate without
 *     provenance is not allowed in) — the exact failure mode the "never
 *     prefix-match" rule above was written to prevent, arriving through the
 *     request door instead.
 * So a client may name ONLY an id that is literally keyed in COST_OF_GOODS,
 * whose rate carries its own provenance. Product cost is zero: no call site
 * sends `model` today. A client that wants a snapshot rate must get its row —
 * with provenance — added to the table first.
 *
 * This is deliberately the REQUEST side only. The SSM-selected model is never
 * gated this way: blocking it would make metering veto delivery, which is the
 * rule the amended analysis exists to protect. An SSM model with no row still
 * delivers and still settles as a visible 0.
 */
export function isRequestableModel(model: string): boolean {
  return Object.hasOwn(COST_OF_GOODS, model);
}
