// api/trpc/context.ts
//
// Turns an incoming request into a tRPC context.
//
// Model (single-user B2C): `users` rows are people; users.external_id holds
// Clerk's user id. There are no tenants/orgs.
//
// Per-request resolution:
//   1. Verify the JWT via authProvider (offline, no network call).
//   2. Look up the local users row by external_id → ctx.userId + ctx.role.
//   ctx.externalUserId is set whenever the token is valid, even before the
//   user.created webhook has created the local row (signup race window).

import type { CreateAWSLambdaContextOptions } from "@trpc/server/adapters/aws-lambda";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../../drizzle/schema";
import { authProvider } from "../lib/auth-provider";

export type Context = {
  externalUserId: string | null;
  userId: string | null;
  role: string | null;
};

type FlatHeaders = Record<string, string | undefined>;

const EMPTY: Context = {
  externalUserId: null,
  userId: null,
  role: null,
};

async function createContextFromHeaders(headers: FlatHeaders): Promise<Context> {
  const auth = headers["authorization"];
  if (auth?.startsWith("Bearer ") !== true) {
    return EMPTY;
  }

  try {
    const verified = await authProvider.verifyToken(auth.slice(7));
    const externalUserId = verified.sub;
    if (externalUserId.length === 0) {
      console.warn("[auth] JWT missing sub claim");
      return EMPTY;
    }

    const [row] = await db
      .select({ userId: users.id, role: users.role })
      .from(users)
      .where(eq(users.externalId, externalUserId))
      .limit(1);

    if (!row) {
      // Valid token but no local user row yet — signup race window before the
      // user.created webhook lands.
      return { ...EMPTY, externalUserId };
    }

    return { externalUserId, userId: row.userId, role: row.role };
  } catch (err) {
    console.error("[auth] JWT verification failed", err);
    return EMPTY;
  }
}

function normalizeHeaders(raw: Record<string, string | string[] | undefined>): FlatHeaders {
  const out: FlatHeaders = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export async function createContext({
  event,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>): Promise<Context> {
  return createContextFromHeaders(event.headers);
}

export async function createExpressContext({
  req,
}: {
  req: { headers: Record<string, string | string[] | undefined> };
}): Promise<Context> {
  return createContextFromHeaders(normalizeHeaders(req.headers));
}
