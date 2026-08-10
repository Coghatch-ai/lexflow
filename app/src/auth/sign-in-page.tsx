import type { ReactElement } from "react";
import { SignIn } from "@clerk/clerk-react";
import { AuthShell } from "./auth-shell";
import { clerkAppearance, AUTH_ROUTES } from "./appearance";

// Branded sign-in screen, shown by App.tsx whenever the user is signed out.
//
// routing="virtual" keeps Clerk's multi-step flow inside the component instead of pushing
// URLs — the app's wouter router only covers the signed-IN routes, so Clerk must not try to
// own the address bar here. signUpUrl points at the app's own /sign-up route, so the
// "Não possui uma conta? Registre-se" link stays in the product instead of defaulting to the
// hosted Account Portal (which cannot be themed from code).
export function SignInPage(): ReactElement {
  return (
    <AuthShell
      headline={
        <>
          Estudo de Ordem,
          <br />
          conduzido com método.
        </>
      }
      blurb="Simulados adaptativos, revisão espaçada e análise de erros — tudo num só painel, calibrado para a sua aprovação."
    >
      <SignIn routing="virtual" signUpUrl={AUTH_ROUTES.signUp} appearance={clerkAppearance} />
    </AuthShell>
  );
}
