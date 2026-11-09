// shared/lib/require-env.ts
//
// One honest read of a required env var, for the modules that fail fast at
// import time (#109). Before this existed, five call sites dereferenced
// `import.meta.env.X.length` against a `.d.ts` that lied about the type being
// non-optional, so an absent var produced `TypeError: Cannot read properties of
// undefined (reading 'length')` instead of a named error.
//
// Pure, no imports, no browser or node globals — compiled by tsconfig.api.json
// at max strictness and importable by both app/ and apps/mobile/.

/** The value, or throw `Missing <name>` when it is absent or empty. */
export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
