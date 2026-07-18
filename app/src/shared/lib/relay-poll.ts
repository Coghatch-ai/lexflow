// app/src/shared/lib/relay-poll.ts
//
// Re-export from the repo-level shared/ module so existing web callers keep
// working without import changes. Mobile imports directly from @shared/lib/relay-poll.
export { pollRelayJob, type RelayJobStatus } from "@shared/lib/relay-poll";
