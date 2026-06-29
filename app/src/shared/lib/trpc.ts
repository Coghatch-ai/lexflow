// app/src/shared/lib/trpc.ts
//
// tRPC React Query client. Imports the AppRouter type from the Lambda handler
// so every trpc.*.useQuery / .useMutation call is typed end-to-end.

import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@api/handler";

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

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: apiUrl,
      transformer: superjson,
      async headers() {
        const token = getToken !== null ? await getToken() : null;
        return token !== null && token.length > 0 ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
