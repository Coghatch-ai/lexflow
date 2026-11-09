import type { ReactElement, ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";
import { ptBR } from "@clerk/localizations";
import { requireEnv } from "@shared/lib/require-env";

const PUBLISHABLE_KEY = requireEnv(
  "VITE_CLERK_PUBLISHABLE_KEY",
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} localization={ptBR} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}
