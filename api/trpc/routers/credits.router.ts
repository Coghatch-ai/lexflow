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
//
// Coupon kinds (S4, issue #53):
//   'credits'      — grants valueCredits to credit_ledger (legacy default)
//   'allowance'    — grants valueUnits to allowance_ledger via grantAllowance
//   'subscription' — activates a subscription period via grantSubscription
//
// All three kinds go through the same atomic-cap + replay-guard rails.
//
// Read procedures (issue #56):
//   allowanceBalance     — remaining allowance units + period end (protectedProcedure)
//   subscriptionStatus   — plan + status + period dates; free user → {plan:"free",status:"none"}

import { z } from "zod";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../procedures";
import { db } from "../../db/client";
import { coupons, creditLedger, subscriptions } from "../../../drizzle/schema";
import { getBalance, grantCredits } from "../../lib/credits";
import { grantAllowance, getAllowanceBalance } from "../../lib/allowance";
import { grantSubscription } from "../../lib/subscription";
import {
  COUPON_ALPHABET,
  COUPON_CODE_REGEX,
  CREDIT_COSTS,
  normalizeCouponCode,
} from "../../../shared/domain/credits";
import { COUPON_KINDS, type CouponKind } from "../../../shared/domain/coupons";

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

// ── Redeem helpers ───────────────────────────────────────────────────────────
// Extracted to keep the mutation arrow function under max-lines-per-function.

type TxClient = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
type RedeemWon = {
  kind: string;
  valueCredits: number;
  valueUnits: number;
  valuePeriodMonths: number;
};

/** Branch on coupon kind inside a transaction — all four writes in ONE tx (F1). */
async function redeemInTx(
  tx: TxClient,
  userId: string,
  code: string,
  won: RedeemWon,
): Promise<{ kind: CouponKind; granted: number }> {
  // F2: validate kind against the known set — reject unknown kinds (Codex finding #2).
  if (!(COUPON_KINDS as readonly string[]).includes(won.kind)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Cupom com tipo desconhecido: ${won.kind}`,
    });
  }
  const kind = won.kind as CouponKind;
  const replayRefId = `coupon:${code}:${userId}`;

  if (kind === "credits") {
    // Rail 2a: replay guard via credit_ledger ref_id unique index.
    // NO onConflictDoNothing — replay must throw to roll back cap increment.
    await tx.insert(creditLedger).values({
      userId,
      delta: won.valueCredits,
      action: "coupon_grant",
      refId: replayRefId,
      note: code,
      createdBy: userId,
      lastUpdBy: userId,
    });
    return { kind, granted: won.valueCredits };
  }

  if (kind === "allowance") {
    // F2: reject non-positive valueUnits (do not default; throw instead).
    if (won.valueUnits <= 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Cupom de allowance sem valueUnits válido",
      });
    }
    // Rail 2b: sentinel + F1: grantAllowance inside tx — all writes in ONE tx.
    await tx.insert(creditLedger).values({
      userId,
      delta: 0,
      action: "coupon_grant",
      refId: replayRefId,
      note: `allowance:${code}`,
      createdBy: userId,
      lastUpdBy: userId,
    });
    await grantAllowance(userId, won.valueUnits, "top_up", replayRefId, `coupon:${code}`, tx);
    return { kind, granted: won.valueUnits };
  }

  // kind === "subscription" (exhaustive — COUPON_KINDS has 3 members)
  // F2: reject non-positive valuePeriodMonths (do not default to 1).
  if (won.valuePeriodMonths <= 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Cupom de assinatura sem valuePeriodMonths válido",
    });
  }
  // Rail 2c: sentinel inside tx + F1/F3: grantSubscription receives tx + idempotencyKey.
  await tx.insert(creditLedger).values({
    userId,
    delta: 0,
    action: "coupon_grant",
    refId: replayRefId,
    note: `subscription:${code}`,
    createdBy: userId,
    lastUpdBy: userId,
  });
  await grantSubscription(userId, won.valuePeriodMonths, replayRefId, `coupon:${code}`, tx);
  return { kind, granted: won.valuePeriodMonths };
}

export const creditsRouter = router({
  // Current balance + the per-action price list (the client shows costs, never
  // computes them).
  balance: protectedProcedure.query(async ({ ctx }) => {
    return { balance: await getBalance(ctx.userId), costs: CREDIT_COSTS };
  }),

  // Remaining allowance units for CORE AI (phase-1 explanation + phase-2 grading).
  // Reuses getAllowanceBalance (SUM(delta) from allowance_ledger, paid path only).
  // periodEnd: null when the user has no active subscription row.
  // No config numbers exposed — balance is derived purely from the ledger.
  allowanceBalance: protectedProcedure.query(
    async ({ ctx }): Promise<{ balance: number; periodEnd: string | null }> => {
      const [sub] = await db
        .select({ currentPeriodEnd: subscriptions.currentPeriodEnd })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .limit(1);
      const balance = await getAllowanceBalance(ctx.userId);
      return {
        balance,
        periodEnd: sub?.currentPeriodEnd ?? null,
      };
    },
  ),

  // Subscription plan + period for the signed-in user.
  // Free user (no subscriptions row) returns plan:"free", status:"none", null dates —
  // never an error. Explicit return type avoids tRPC union-strip of null fields.
  subscriptionStatus: protectedProcedure.query(
    async ({
      ctx,
    }): Promise<{
      plan: string;
      status: string;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
    }> => {
      const [sub] = await db
        .select({
          plan: subscriptions.plan,
          status: subscriptions.status,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .limit(1);
      if (sub === undefined) {
        return {
          plan: "free",
          status: "none",
          currentPeriodStart: null,
          currentPeriodEnd: null,
        };
      }
      return {
        plan: sub.plan,
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
    },
  ),

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

  // Redeem a coupon. Branches on kind after the atomic-cap + replay-guard rails.
  // All three kinds use the SAME two-rail safety (atomic cap + replay guard).
  // F1: cap increment + sentinel + grant all happen inside ONE transaction via redeemInTx.
  redeem: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const code = normalizeCouponCode(input.code);
      if (!COUPON_CODE_REGEX.test(code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Formato de cupom inválido" });
      }
      try {
        return await db.transaction(async (tx) => {
          // Rail 1: atomic cap — increment redeemedCount only when < max and not expired.
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
            .returning({
              kind: coupons.kind,
              valueCredits: coupons.valueCredits,
              valueUnits: coupons.valueUnits,
              valuePeriodMonths: coupons.valuePeriodMonths,
            });
          if (won === undefined) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Cupom inválido, esgotado ou expirado",
            });
          }
          // Rail 2 + F1 + F2 + F3: kind validation, value guards, sentinel, grant — all in tx.
          return redeemInTx(tx, ctx.userId, code, won);
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Você já resgatou este cupom" });
        }
        throw err;
      }
    }),

  // Mint a coupon (admin). kind selects which value field is required.
  mintCoupon: adminProcedure
    .input(
      z.object({
        code: z.string().optional(),
        kind: z.enum(COUPON_KINDS).default("credits"),
        valueCredits: z.number().int().min(0).max(100_000).default(0),
        valueUnits: z.number().int().min(0).max(1_000_000).default(0),
        valuePeriodMonths: z.number().int().min(0).max(120).default(0),
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

      // Kind-specific value validation.
      if (input.kind === "credits" && input.valueCredits <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cupom de créditos requer valueCredits > 0",
        });
      }
      if (input.kind === "allowance" && input.valueUnits <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cupom de allowance requer valueUnits > 0",
        });
      }
      if (input.kind === "subscription" && input.valuePeriodMonths <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cupom de assinatura requer valuePeriodMonths > 0",
        });
      }

      const inserted = await db
        .insert(coupons)
        .values({
          code,
          kind: input.kind,
          valueCredits: input.valueCredits,
          valueUnits: input.valueUnits,
          valuePeriodMonths: input.valuePeriodMonths,
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
      return { code, kind: input.kind };
    }),

  // Coupon inventory (admin).
  listCoupons: adminProcedure.query(async () => {
    return db
      .select({
        code: coupons.code,
        kind: coupons.kind,
        valueCredits: coupons.valueCredits,
        valueUnits: coupons.valueUnits,
        valuePeriodMonths: coupons.valuePeriodMonths,
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
