// api/trpc/routers/credits.router.ts
//
// Credit balance + ledger for the signed-in student, coupon redemption (the
// only user-facing top-up until a purchase flow exists), and admin mint/grant.
//
// Redemption safety (maggie #126 pattern), two independent rails:
//   1. Atomic cap — conditional UPDATE (WHERE redeemed_count < max AND
//      not-expired RETURNING) locks the coupon row: at most maxRedemptions
//      winners globally, even under concurrency.
//   2. Replay guard — ledger ref_id `coupon:<code>:<userId>` (unique index)
//      caps ONE redemption per user per coupon. Cap increments FIRST; a replay
//      throws on the ledger insert and rolls the whole transaction back, so a
//      double-redeem never permanently burns a redemption slot.

import { z } from "zod";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../procedures";
import { db } from "../../db/client";
import { coupons, creditLedger } from "../../../drizzle/schema";
import { getBalance, grantCredits } from "../../lib/credits";
import {
  COUPON_ALPHABET,
  COUPON_CODE_REGEX,
  CREDIT_COSTS,
  normalizeCouponCode,
} from "../../../shared/domain/credits";

function randomCouponCode(): string {
  const pick = (): string => {
    const bytes = randomBytes(4);
    let out = "";
    for (const b of bytes) out += COUPON_ALPHABET[b % COUPON_ALPHABET.length] ?? "A";
    return out;
  };
  return `${pick()}-${pick()}`;
}

// Postgres unique_violation (23505), possibly wrapped by drizzle (check cause).
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export const creditsRouter = router({
  // Current balance + the per-action price list (the client shows costs, never
  // computes them).
  balance: protectedProcedure.query(async ({ ctx }) => {
    return { balance: await getBalance(ctx.userId), costs: CREDIT_COSTS };
  }),

  // Recent ledger rows, newest first.
  ledger: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: creditLedger.id,
        delta: creditLedger.delta,
        action: creditLedger.action,
        note: creditLedger.note,
        createdAt: creditLedger.createdAt,
      })
      .from(creditLedger)
      .where(ctx.db.conditions(creditLedger))
      .orderBy(desc(creditLedger.createdAt))
      .limit(50);
  }),

  // Redeem a coupon for its face value. See safety rails in the header comment.
  redeem: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const code = normalizeCouponCode(input.code);
      if (!COUPON_CODE_REGEX.test(code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Formato de cupom inválido" });
      }
      try {
        return await db.transaction(async (tx) => {
          const [won] = await tx
            .update(coupons)
            .set({ redeemedCount: sql`${coupons.redeemedCount} + 1`, lastUpdAt: sql`now()` })
            .where(
              and(
                eq(coupons.code, code),
                lt(coupons.redeemedCount, coupons.maxRedemptions),
                or(isNull(coupons.expiresAt), gt(coupons.expiresAt, sql`now()`)),
              ),
            )
            .returning({ valueCredits: coupons.valueCredits });
          if (won === undefined) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Cupom inválido, esgotado ou expirado",
            });
          }
          // NO onConflictDoNothing here — a replay must THROW so the cap
          // increment above rolls back with it.
          await tx.insert(creditLedger).values({
            userId: ctx.userId,
            delta: won.valueCredits,
            action: "coupon_grant",
            refId: `coupon:${code}:${ctx.userId}`,
            note: code,
            createdBy: ctx.userId,
            lastUpdBy: ctx.userId,
          });
          return { granted: won.valueCredits };
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Você já resgatou este cupom" });
        }
        throw err;
      }
    }),

  // Mint a coupon (admin). Code optional — generated server-side when absent.
  mintCoupon: adminProcedure
    .input(
      z.object({
        code: z.string().optional(),
        valueCredits: z.number().int().positive().max(100_000),
        maxRedemptions: z.number().int().positive().max(10_000).default(1),
        expiresAt: z.string().datetime().optional(),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const code = input.code !== undefined ? normalizeCouponCode(input.code) : randomCouponCode();
      if (!COUPON_CODE_REGEX.test(code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Formato de cupom inválido" });
      }
      const inserted = await db
        .insert(coupons)
        .values({
          code,
          valueCredits: input.valueCredits,
          maxRedemptions: input.maxRedemptions,
          expiresAt: input.expiresAt ?? null,
          note: input.note ?? null,
          createdBy: ctx.userId,
          lastUpdBy: ctx.userId,
        })
        .onConflictDoNothing({ target: coupons.code })
        .returning({ code: coupons.code });
      if (inserted.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Código de cupom já existe" });
      }
      return { code };
    }),

  // Coupon inventory (admin).
  listCoupons: adminProcedure.query(async () => {
    return db
      .select({
        code: coupons.code,
        valueCredits: coupons.valueCredits,
        maxRedemptions: coupons.maxRedemptions,
        redeemedCount: coupons.redeemedCount,
        expiresAt: coupons.expiresAt,
        note: coupons.note,
        createdAt: coupons.createdAt,
      })
      .from(coupons)
      .orderBy(desc(coupons.createdAt))
      .limit(100);
  }),

  // Admin top-up (manual, until the purchase flow exists).
  grant: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        credits: z.number().int().positive().max(100_000),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await grantCredits(
        input.userId,
        input.credits,
        "admin_grant",
        `admin:${randomUUID()}`,
        input.note,
      );
      const [row] = await db
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(eq(creditLedger.userId, input.userId))
        .limit(1);
      return { ok: true as const, granted: input.credits, userExists: row !== undefined };
    }),
});
