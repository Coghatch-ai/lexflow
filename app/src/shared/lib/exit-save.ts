// app/src/shared/lib/exit-save.ts
//
// How the LAST write of a run leaves the tab (BR-05 / BR-05.5, epic #67 slice
// S2d — Codex adversarial review of #79).
//
// The problem it answers: `pagehide` gives a handler ONE synchronous chance. A
// normal `fetch` issued there is cancelled with the document, and anything that
// awaits a network answer first is never issued at all. `navigator.sendBeacon`
// survives, but cannot carry `Authorization` — every call here is
// `protectedProcedure`, so a beacon is a guaranteed 401. `fetch` with
// `keepalive: true` is the one transport that carries headers AND is completed
// by the browser after the document is gone. Its price is a hard cap on the
// request body, which is what this module is about.
//
// Pure and React-free: the size decision is provable with plain vitest, while
// the transport it selects (`exitTrpcClient`) is only reachable in a browser.

/**
 * The body budget for a `keepalive` request.
 *
 * The Fetch standard rejects a keepalive request when the sum of its body and
 * every other in-flight keepalive body exceeds 64 KiB (65 536 bytes). A prova
 * real draft is ~25 KB of jsonb today, so the budget is not academic: a long
 * exam whose `answers` array kept every change can approach it.
 *
 * 56 000 leaves ~9 KB of headroom for the tRPC batch envelope, superjson's
 * `meta`, and any other keepalive request the page has out. Over budget the
 * request would be REJECTED outright — losing everything — so the guard trades
 * the guarantee for the old best-effort instead of gambling on the cap.
 */
export const KEEPALIVE_MAX_BYTES = 56_000;

/** Which client the exit write must go out on. */
export type ExitTransport = "keepalive" | "normal";

/**
 * The body size of a payload, in BYTES rather than characters: the cap is on
 * bytes, and a pt-BR note or a question id with an accent is 2 bytes per
 * character. Measured on `JSON.stringify` of the payload, which is within a few
 * percent of the wire body (the batch envelope and superjson's `meta` are the
 * difference, and the budget above absorbs them).
 */
export function exitBodyBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * `keepalive` while the payload fits, the normal client otherwise.
 *
 * Falling back is not a silent downgrade — it is the pre-existing best-effort
 * behaviour, which lands whenever the tab is merely hidden rather than closed.
 * The alternative (send it anyway) is strictly worse: an over-budget keepalive
 * request is rejected by the browser, so it would turn a partial guarantee into
 * none at all.
 */
export function exitTransportFor(payload: unknown): ExitTransport {
  return exitBodyBytes(payload) <= KEEPALIVE_MAX_BYTES ? "keepalive" : "normal";
}
