// api/trpc/procedures.ts
//
// Procedure tiers (single-user B2C — no tenants):
//
//   publicProcedure    — no auth (health checks, the public oab_questions catalog).
//   verifiedProcedure  — JWT-verified, ctx.externalUserId only. No local users
//                        row required (signup race window).
//   protectedProcedure — JWT-verified AND local users row present. Default for
//                        anything that reads/writes the signed-in user's data.
//                        Builds ctx.db (the scoped DB handle, keyed by userId).
//   adminProcedure     — protected + users.role === "admin".

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import { createScopedDb, type ScopedDb } from "../db/scope";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const verifiedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.externalUserId === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { externalUserId: ctx.externalUserId, userId: ctx.userId, role: ctx.role } });
});

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.userId === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const db: ScopedDb = createScopedDb({ userId: ctx.userId });
  return next({ ctx: { userId: ctx.userId, role: ctx.role, db } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
