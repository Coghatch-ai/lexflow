// app/src/auth/use-token.ts
//
// Exposes the provider's JWT getter to the tRPC client wiring without leaking a
// @clerk import outside auth/. TrpcProvider feeds the returned getter into
// setTokenGetter() so every tRPC request carries a fresh bearer token.

import { useAuth } from "@clerk/clerk-react";

export function useGetToken(): () => Promise<string | null> {
  const { getToken } = useAuth();
  return getToken;
}
