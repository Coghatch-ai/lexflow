// api/lib/auth-provider/clerk.ts
//
// Clerk implementation of AuthProvider. Token verification is offline (no
// network round-trip per request) using CLERK_JWT_KEY (the PEM public key from
// Clerk Dashboard → API Keys).

import { verifyToken } from "@clerk/backend";
import type { AuthProvider, VerifiedToken } from "./types";

export const clerkAuthProvider: AuthProvider = {
  async verifyToken(token: string): Promise<VerifiedToken> {
    const jwtKey = process.env["CLERK_JWT_KEY"];
    if (jwtKey === undefined || jwtKey.length === 0) {
      throw new Error("CLERK_JWT_KEY is not set");
    }
    const payload = await verifyToken(token, { jwtKey });
    return { sub: payload.sub };
  },
};
