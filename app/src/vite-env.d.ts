/// <reference types="vite/client" />

// All optional on purpose (#109): the build-time substitution is absent in any
// environment without an `.env` (CI, a fresh clone), so a non-optional `string`
// is a lie about the runtime and lets `tsc` wave through an unguarded deref
// that then crashes with a `TypeError`. Honest types + `requireEnv` are the
// recurrence guard — do not drop the `?`.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_ISSUES_FUNCTION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
