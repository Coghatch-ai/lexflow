import type { ReactElement } from "react";
import { SignUp } from "@clerk/clerk-react";
import { AuthShell } from "./auth-shell";
import { clerkAppearance, AUTH_ROUTES } from "./appearance";

// Branded sign-up screen — the whole point of this file is that registration NEVER leaves the
// product. Without it, <SignIn>'s footer link falls back to Clerk's hosted Account Portal
// (accounts.<root>/sign-up), which renders in Clerk's default purple, in English regardless of
// the ptBR localization, and cannot be styled from code — only from the Clerk Dashboard.
//
// Same AuthShell and same appearance object as sign-in, so the two screens are identical apart
// from the widget. routing="virtual" for the same reason as sign-in: wouter only owns the
// signed-in routes, so Clerk must not drive the URL through its multi-step flow.
export function SignUpPage(): ReactElement {
  return (
    <AuthShell
      headline={
        <>
          Comece agora,
          <br />
          estude com método.
        </>
      }
      blurb="Crie a sua conta para acessar simulados adaptativos, revisão espaçada e análise de erros num só painel."
    >
      <SignUp routing="virtual" signInUrl={AUTH_ROUTES.signIn} appearance={clerkAppearance} />
    </AuthShell>
  );
}
