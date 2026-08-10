// app/src/auth/appearance.ts
//
// ONE Clerk appearance object, shared by every Clerk component in the app.
//
// Why this is a module and not inlined per page: <SignIn> and <SignUp> sit side by side in
// the same flow, so any divergence between them is visible to the user as the form "changing
// skin" mid-journey. Defining it once makes drift impossible.
//
// SCOPE — this styles EMBEDDED components only. It has no effect on Clerk's hosted Account
// Portal (accounts.<root>), which is themed exclusively from the Clerk Dashboard
// (Customization → Appearance/Branding, i.e. display_config.theme). That is precisely why the
// app mounts its own <SignUp>: it is the only way sign-up can match the product.
// Type derived from the component's own props rather than importing @clerk/types, which is a
// transitive dependency we do not declare — this stays correct if Clerk reshapes it.
import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/clerk-react";

type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

/** Chambers palette — mirrors the tokens in index.css (ink / seal / paper / line). */
export const clerkAppearance: ClerkAppearance = {
  variables: {
    colorPrimary: "#16161a",
    colorText: "#16161a",
    colorTextSecondary: "#6b6b75",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    borderRadius: "10px",
    fontFamily: '"Hanken Grotesk", sans-serif',
  },
  elements: {
    card: "shadow-none border border-line",
    headerTitle: "font-display",
    formButtonPrimary: "bg-ink hover:bg-ink-raised text-surface normal-case font-semibold",
    footerActionLink: "text-seal hover:text-ink",
  },
};

/** In-app auth routes. Passed to Clerk as signUpUrl/signInUrl so its footer links stay INSIDE
 * the app instead of defaulting to the hosted Account Portal. Kept next to the appearance so
 * the routing contract and the styling contract are read together. */
export const AUTH_ROUTES = { signIn: "/", signUp: "/sign-up" } as const;
