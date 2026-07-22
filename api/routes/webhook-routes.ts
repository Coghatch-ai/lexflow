// api/routes/webhook-routes.ts
//
// Clerk webhook handler. This is the ONLY place where rows in the `users` table
// are created — every other code path assumes the row already exists (see
// api/trpc/context.ts). Signature verification uses Svix (Clerk's signing lib).
//
// Single-user B2C: we only care about user lifecycle events. There are no
// organizations or memberships.

import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { adminDb } from "../db/admin-client";
import { users } from "../../drizzle/schema";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function ok(body: unknown): LambdaResponse {
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) };
}
function bad(status: number, message: string): LambdaResponse {
  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

type ClerkUserEvent = {
  type: "user.created" | "user.updated" | "user.deleted";
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
};

function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const parts = [first, last].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" ") : null;
}

function primaryEmail(data: ClerkUserEvent["data"]): string | null {
  return data.email_addresses?.[0]?.email_address ?? null;
}

// NO automatic signup credit grant here — it would be farmable (delete account
// → re-register → fresh users.id → another grant, unbounded; maggie #126).
// Credits come only from coupon redemption or an admin grant (credits.router).
async function handleUserCreated(data: ClerkUserEvent["data"]): Promise<void> {
  await adminDb
    .insert(users)
    .values({
      externalId: data.id,
      email: primaryEmail(data),
      name: fullName(data.first_name, data.last_name),
    })
    .onConflictDoNothing();
}

async function handleUserUpdated(data: ClerkUserEvent["data"]): Promise<void> {
  await adminDb
    .update(users)
    .set({
      email: primaryEmail(data),
      name: fullName(data.first_name, data.last_name),
      lastUpdAt: new Date().toISOString(),
    })
    .where(eq(users.externalId, data.id));
}

async function handleUserDeleted(data: ClerkUserEvent["data"]): Promise<void> {
  await adminDb.delete(users).where(eq(users.externalId, data.id));
}

async function dispatchWebhookEvent(evt: ClerkUserEvent): Promise<void> {
  switch (evt.type) {
    case "user.created":
      return handleUserCreated(evt.data);
    case "user.updated":
      return handleUserUpdated(evt.data);
    case "user.deleted":
      return handleUserDeleted(evt.data);
  }
}

/**
 * Route dispatcher. Called from api/handler.ts before the tRPC adapter. Returns
 * a LambdaResponse if the path matched a webhook route, or null to fall through.
 */
export async function handleWebhookRoutes(
  method: string,
  path: string,
  body: string,
  headers: Record<string, string | undefined>,
): Promise<LambdaResponse | null> {
  if (method !== "POST" || path !== "/webhooks/clerk") {
    return null;
  }

  const secret = process.env["CLERK_WEBHOOK_SECRET"];
  if (secret === undefined || secret.length === 0) {
    return bad(500, "CLERK_WEBHOOK_SECRET not configured");
  }

  const svixHeaders = {
    "svix-id": headers["svix-id"] ?? "",
    "svix-timestamp": headers["svix-timestamp"] ?? "",
    "svix-signature": headers["svix-signature"] ?? "",
  };

  let evt: ClerkUserEvent;
  try {
    evt = new Webhook(secret).verify(body, svixHeaders) as ClerkUserEvent;
  } catch (err) {
    console.error("[webhook] signature verification failed", err);
    return bad(401, "invalid signature");
  }

  try {
    await dispatchWebhookEvent(evt);
    return ok({ received: true, type: evt.type });
  } catch (err) {
    console.error("[webhook] handler failed", err);
    return bad(500, "handler error");
  }
}
