// app/src/shared/utils/pick-daily-tip.ts
//
// Pure daily-rotating tip selector. Deterministic per calendar day (UTC epoch days).
// Extracted so it can be unit-tested independently of the component.

/**
 * Selects a tip by index = floor(now / 86_400_000) % tips.length.
 * Rotates once per UTC day; wraps around modulo array length.
 */
export function pickDailyTip(tips: ReadonlyArray<string>, now: number = Date.now()): string {
  const len = tips.length;
  if (len === 0) return "";
  // .at() always returns string | undefined regardless of tsconfig strictness,
  // keeping ?? '' valid under both tsconfig.json and tsconfig.api.json.
  return tips.at(Math.floor(now / 86_400_000) % len) ?? "";
}
