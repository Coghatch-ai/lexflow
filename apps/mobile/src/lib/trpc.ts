// apps/mobile/src/lib/trpc.ts
//
// tRPC React Query client for the mobile POC. Imports the AppRouter type from
// the Lambda handler so every trpc.*.useQuery / .useMutation call is typed
// end-to-end against the SAME backend as the main app (api.probius.app).

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
 * "which draft row is mine", "is there a saved run for this mode" — as opposed
 * to one that merely paints a list.
 *
 * `utils.x.fetch()` is `fetchQuery`: while the entry is fresh under the
 * 5-minute default above it resolves from the CACHE and never reaches the
 * server, so a deleted draft keeps being handed back as alive (and a `null`
 * read keeps being handed back after the row was created).
 */
export const FRESH_READ = { staleTime: 0 } as const;

// Clerk's getToken() is only available inside the React tree, so we inject it
// via this setter from TrpcProvider after the provider mounts.
let getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>): void {
  getToken = getter;
}

// Raw Clerk token for non-tRPC calls (the streaming Lambda's Bearer auth).
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
 * The SAME API over a `fetch` the browser finishes after this document is
 * destroyed — the transport of the one write that has no second chance: the
 * save issued while the student switches app or closes the tab mid-run.
 *
 * On mobile Safari this is the door that matters: `pagehide` is unreliable and
 * `visibilitychange: hidden` is the real app-switch event (both are wired by
 * `wireExitFlush`). A normal request dies with the document; `keepalive` is
 * completed by the browser and — unlike `navigator.sendBeacon` — still carries
 * the `Authorization` header every `protectedProcedure` needs.
 *
 * A separate client rather than a flag on the one above, because `keepalive`
 * caps the body at 64 KiB across all in-flight keepalive requests
 * (`shared/run/exit-save.ts` owns that budget); the catalog and AI calls
 * legitimately exceed it.
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
 * THIS app's clients, as `useRunPersistence` takes them (#86 M2a/M2b).
 *
 * `createTRPCReact()` builds one React context PER instance, so the desktop's
 * instance called from this tree would run `useUtils()` with no provider above
 * it — a runtime failure, not merely coupling. Hence the hook takes the clients
 * as an argument and each app binds its own here, once.
 */
export const runPersistenceIO: RunPersistenceIO = {
  trpc,
  exitClient: exitTrpcClient,
  freshRead: FRESH_READ,
};
