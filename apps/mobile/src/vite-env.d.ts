/// <reference types="vite/client" />

// Optional on purpose (#109) — see app/src/vite-env.d.ts: a non-optional
// `string` hides an unguarded deref from `tsc` until it is a runtime
// `TypeError`. Read these through `requireEnv` (shared/lib/require-env.ts).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Streaming Lambda Function URL; absent → tutor uses the polling relay path. */
  readonly VITE_AI_STREAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
