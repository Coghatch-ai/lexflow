// api/lib/auth-provider/types.ts
//
// Provider-agnostic auth interface. Anything Clerk-specific lives behind this
// seam — to swap to Cognito, write a sibling implementation and re-export it
// from `./index.ts`. The rest of the API depends only on this interface.
//
// LexFlow is single-user B2C with self-service signup: users are created on the
// frontend via the provider's own SDK (password handling, email verification,
// future MFA stay in the provider). The backend only needs to *verify* tokens —
// hence the single method here. The local `users` row is created from the
// provider's user.created webhook (api/routes/webhook-routes.ts).

export type VerifiedToken = {
  sub: string; // Provider's user id (Clerk user id)
};

export interface AuthProvider {
  verifyToken(token: string): Promise<VerifiedToken>;
}
