// apps/mobile/src/auth/use-session.ts
//
// Provider-agnostic session hook. Maps Clerk's useUser into the small shape the
// app UI needs ({ id, email, name }), plus a signOut action. This is the only
// session surface the app should consume — no @clerk imports outside auth/.

import { useClerk, useUser } from "@clerk/clerk-react";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type Session = {
  user: SessionUser | null;
  isLoaded: boolean;
  signOut: () => void;
};

export function useSession(): Session {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const sessionUser: SessionUser | null =
    isSignedIn === true
      ? {
          id: user.id,
          email: user.primaryEmailAddress?.emailAddress ?? "",
          name: user.fullName ?? user.firstName ?? user.primaryEmailAddress?.emailAddress ?? "",
        }
      : null;

  return {
    user: sessionUser,
    isLoaded,
    signOut: () => {
      void signOut();
    },
  };
}
