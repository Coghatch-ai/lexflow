/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  /** Streaming Lambda Function URL; absent → tutor uses the polling relay path. */
  readonly VITE_AI_STREAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
