import { type ReactElement, type ReactNode, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useGetToken } from "../auth";
import { queryClient, setTokenGetter, trpc, trpcClient } from "../lib/trpc";

export function TrpcProvider({ children }: { children: ReactNode }): ReactElement {
  // Feed Clerk's token getter into the tRPC client so every request is authed.
  setTokenGetter(useGetToken());
  const [client] = useState(() => trpcClient);

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
