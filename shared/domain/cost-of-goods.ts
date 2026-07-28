// shared/domain/cost-of-goods.ts
//
// COST-OF-GOODS table + costFor() for the unified credit engine (D3, epic #50).
//
// This is the raw, pre-multiplier COST of an AI call in cents — the `rawCents`
// argument to charge(). It is DELIBERATELY SEPARATE from the billing multiplier
// (`mult.<source>` in credit_config): cost-of-goods is what the provider charges
// US per unit of work; the multiplier is the margin/markup applied on top at
// charge time. Two different knobs, two different owners — never conflate them.
//
// RATES are quoted in CENTS PER 1,000,000 UNITS (the industry-standard "per 1M
// tokens" quote scaled to cents), so a rate row is a small integer and there is
// no float knob. costFor scales the actual usage down by 1M.
//   - tokens / embedding_tokens → cents per 1M tokens
//   - image                     → cents per 1M images (i.e. per-image × 1e6)
//   - chars                     → cents per 1M characters
//   - seconds                   → cents per 1M seconds
//
// INVARIANT: costFor NEVER throws and NEVER returns a negative/non-finite value.
// An unknown model, an unknown usage kind, or a garbage amount collapses to 0 —
// a missing rate must fail OPEN to zero cost, never crash a delivered request or
// (once enforce lands) over-charge. The per-model-rate GUARD test asserts every
// model id in LIVE_MODEL_IDS has a rate row so a real live model is never
// silently metered at 0.

/** The unit a usage figure is measured in. One rate dimension per model. */
export type UsageKind = "tokens" | "image" | "chars" | "seconds" | "embedding_tokens";

/** A measured unit of delivered work: `amount` of `kind` (e.g. 1200 tokens). */
export interface Usage {
  readonly kind: UsageKind;
  readonly amount: number;
}

/** A model's cost-of-goods rate: cents per 1,000,000 units, per usage kind. A
 *  model lists only the dimensions it can be billed on (a chat model → tokens). */
export type ModelRate = Partial<Record<UsageKind, number>>;

/** Scale factor: rates are quoted per 1,000,000 units. */
const RATE_UNIT = 1_000_000;

// ─── The cost-of-goods table ────────────────────────────────────────────────
//
// Rates are cents per 1M tokens (blended input+output — a single dimension is
// sufficient for shadow metering; a split can be added later without touching
// callers). Seeded from the live providers we actually route to (relay-handler:
// DEFAULT_GEMINI_MODEL / DEFAULT_OPENAI_MODEL + the grade per-task overrides).
// Every id here MUST appear in LIVE_MODEL_IDS (and vice-versa) — the guard test
// enforces the round-trip so a newly-routed model can never meter at 0.
export const COST_OF_GOODS: Readonly<Record<string, ModelRate>> = {
  // OpenAI (prod default — CLAUDE.md: production runs OpenAI gpt-4o-mini).
  "gpt-4o-mini": { tokens: 45 }, // ~US$0.45 / 1M blended → 45¢/1M
  "gpt-4o": { tokens: 750 },
  // Gemini (code default fallback in relay-handler).
  "gemini-2.0-flash": { tokens: 20 },
  "gemini-1.5-flash": { tokens: 20 },
  "gemini-1.5-pro": { tokens: 350 },
};

// The model ids that can appear in LIVE traffic — the relay-handler defaults plus
// any provider/model a call site may pass through. The guard test asserts each of
// these resolves to a rate row so a live call is never silently metered at 0.
export const LIVE_MODEL_IDS: readonly string[] = [
  "gpt-4o-mini",
  "gpt-4o",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

/**
 * Raw (pre-multiplier) cost in cents for `usage` of `model`. TOTAL + PURE:
 *   - unknown model            → 0 (fail-open, never throw)
 *   - model lacks the kind rate → 0
 *   - non-finite / negative amt → 0 (clamped)
 * The result is fractional (sub-cent) on purpose — charge()'s bag carries the
 * remainder. Never negative, never non-finite.
 */
export function costFor(model: string, usage: Usage): number {
  const rate = COST_OF_GOODS[model];
  if (rate === undefined) return 0;
  const perMillion = rate[usage.kind];
  if (perMillion === undefined || !Number.isFinite(perMillion) || perMillion < 0) return 0;
  const amount = Number.isFinite(usage.amount) && usage.amount > 0 ? usage.amount : 0;
  return (amount * perMillion) / RATE_UNIT;
}

/** True when `model` has a cost-of-goods rate row (used by the guard test). */
export function hasCostRate(model: string): boolean {
  return COST_OF_GOODS[model] !== undefined;
}
