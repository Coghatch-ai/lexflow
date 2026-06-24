// apps/mobile/src/auth/index.ts
//
// The single import surface for auth in the mobile app. Outside this folder, no
// file should import from `@clerk/*` — go through here. To swap providers,
// replace the implementations in this folder; the rest of the app keeps compiling.

export { AuthProvider } from "./provider";
export { SignInPage } from "./sign-in-page";
export { useSession } from "./use-session";
export type { Session, SessionUser } from "./use-session";
export { useGetToken } from "./use-token";
export { SignedIn, SignedOut } from "@clerk/clerk-react";
