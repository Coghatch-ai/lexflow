// app/src/shared/lib/trpc.ts
//
// tRPC React Query client. Imports the AppRouter type from the Lambda handler
// so every trpc.*.useQuery / .useMutation call is typed end-to-end.

import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@api/handler";
import type { RunPersistenceIO } from "@shared/react/use-run-persistence";

export type TrpcOutput = inferRouterOutputs<AppRouter>;
export type TrpcInput = inferRouterInputs<AppRouter>;

export const trpc = createTRPCReact<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

/**
 * Per-call override for a read whose ANSWER decides identity or existence —
 * "which draft row is mine", "is the relay job done" — as opposed to one that
 * merely paints a list.
 *
 * `utils.x.fetch()` is `fetchQuery`: while the entry is fresh under the
 * 5-minute default above, it resolves from the CACHE and never reaches the
 * server. For a poll that means it never finishes; for `examDrafts.get` it meant
 * a deleted row kept being handed back as alive (and a `null` read kept being
 * handed back after the row was created), which is a retry that cannot work.
 */
export const FRESH_READ = { staleTime: 0 } as const;

// Clerk's getToken() is only available inside the React tree, so we inject it
// via this setter from TrpcProvider after the provider mounts.
let getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>): void {
  getToken = getter;
}

// Same injected Clerk getter, exposed for non-tRPC fetch clients (e.g. the central
// mrhewbuc-issues Function URL client) so they share one session-token source.
export async function getAuthToken(): Promise<string | null> {
  return getToken !== null ? getToken() : null;
}

const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl.length === 0) {
  throw new Error("VITE_API_URL is required");
}

/** The Clerk bearer, or nothing — shared by both clients below. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = getToken !== null ? await getToken() : null;
  return token !== null && token.length > 0 ? { authorization: `Bearer ${token}` } : {};
}

export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: apiUrl, transformer: superjson, headers: authHeaders })],
});

/**
 * The SAME API, over a `fetch` the browser finishes after this document is
 * destroyed (Codex adversarial review of #79).
 *
 * For the one write that has no second chance: the save issued from `pagehide`
 * while the student closes the tab mid-exam. A normal request is cancelled with
 * the document; `keepalive` is completed by the browser, and — unlike
 * `navigator.sendBeacon` — it carries the `Authorization` header every
 * `protectedProcedure` needs.
 *
 * A separate client rather than a flag on the one above, because `keepalive`
 * caps the request body at 64 KiB across all in-flight keepalive requests
 * (`exit-save.ts` owns that budget). Making every call keepalive would put that
 * cap on the seed, the AI grading and the question catalog, which legitimately
 * exceed it.
 *
 * Deliberately NOT paired with a cached token: `getToken()` resolves from
 * Clerk's own cache without a round trip while the token is valid, and a cache
 * of ours would just as often hold an EXPIRED one (Clerk session tokens live
 * 60 s) — which is a silent 401 where Clerk would have refreshed. The residual
 * risk is stated where it is taken (`use-run-persistence.ts`).
 */
export const exitTrpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: apiUrl,
      transformer: superjson,
      headers: authHeaders,
      fetch: (url, options) => fetch(url, { ...options, keepalive: true }),
    }),
  ],
});

/**
 * THIS app's three clients, as `useRunPersistence` takes them (#86 M2a).
 *
 * The hook moved to `shared/react/` so the mobile POC can call it too, and the
 * clients became an argument: `createTRPCReact()` builds one React context per
 * instance, so the instance above called from another tree would run
 * `useUtils()` with no provider. Bound once here rather than spelled out at each
 * of the four boards — the desktop has exactly one answer.
 */
export const runPersistenceIO: RunPersistenceIO = {
  trpc,
  exitClient: exitTrpcClient,
  freshRead: FRESH_READ,
};
