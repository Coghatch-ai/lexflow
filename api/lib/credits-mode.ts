// api/lib/credits-mode.ts
//
// CREDITS_MODE env rail (D3, epic #50) — the switch that gates the unified money
// engine's cutover. Read LIVE from process.env (no cache) so an env change on the
// Lambda takes effect on the next cold start without a code change.
//
//   unset / "enforce" → ENFORCE: charge() writes for real; admission may deny.
//   "shadow"          → SHADOW:  charge() runs dryRun (writes NOTHING) and
//                                admission NEVER denies. The old debit-at-admission
//                                rail stays authoritative — the new path only
//                                OBSERVES delivered results + emits reconcile metrics.
//   "off"             → OFF:     skip the new charge() path entirely (no shadow,
//                                no enforce) — a kill switch.
//
// D3 SHIPS DEFAULTED TO "shadow" (see creditsMode() default below): this slice
// wires the NEW delivered-only path ALONGSIDE the authoritative old debit rail and
// reconciles the two from real traffic. The enforce flip is D4, gated on that
// reconciliation parity. Do NOT change the default to enforce in this slice.

export type CreditsMode = "enforce" | "shadow" | "off";

/**
 * Resolve CREDITS_MODE from the environment. D3 default is "shadow" (safe
 * cutover: observe + reconcile, never deny, never write). Only the exact strings
 * "enforce" / "off" opt out; any other value (incl. unset) → "shadow".
 */
export function creditsMode(): CreditsMode {
  const raw = process.env.CREDITS_MODE?.trim().toLowerCase();
  if (raw === "enforce") return "enforce";
  if (raw === "off") return "off";
  return "shadow"; // D3 default — shadow-first cutover.
}

/** true in SHADOW → charge() must run dryRun and admission must never deny. */
export function isShadow(): boolean {
  return creditsMode() === "shadow";
}

/** true in OFF → skip the new charge() path entirely (kill switch). */
export function isOff(): boolean {
  return creditsMode() === "off";
}
