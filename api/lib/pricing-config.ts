// api/lib/pricing-config.ts
//
// Typed accessor for the admin-editable pricing_config table (S5, issue #53).
// ALL numbers governing pricing, allowance sizes, and pack sizes must be read
// from here — NEVER hardcoded. Owner directive: no magic numbers.
//
// Unset-real-cost guard: `requireRealCostPerUnit()` throws INTERNAL_SERVER_ERROR
// when the 'real_cost_per_unit' row is null/missing. Call this from any endpoint
// that would expose a live BRL price to the user. The key is seeded by the owner
// after running `pnpm eval` to determine the actual cost per unit.
//
// All callers should use getConfigValue() / requireConfigNumber() rather than
// querying pricing_config directly — keeps the guard logic in one place.

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client";
import { pricingConfig } from "../../drizzle/schema";

// Well-known config keys — extend as new numbers are added.
export const CONFIG_KEYS = {
  PLAN_PRICE_BRL: "plan_price_brl",
  MONTHLY_ALLOWANCE_UNITS: "monthly_allowance_units",
  FREE_DAILY_LIMIT: "free_daily_limit",
  ALLOWANCE_PACK_UNITS: "allowance_pack_units",
  CREDIT_PACK_SIZE: "credit_pack_size",
  REAL_COST_PER_UNIT: "real_cost_per_unit",
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

/** Raw row from pricing_config. null numericValue = not yet seeded. */
export type PricingConfigRow = {
  key: string;
  numericValue: string | null;
  textValue: string | null;
  description: string | null;
};

/** Fetch a single config row. Returns undefined when the key does not exist. */
export async function getConfigRow(key: string): Promise<PricingConfigRow | undefined> {
  const [row] = await db
    .select({
      key: pricingConfig.key,
      numericValue: pricingConfig.numericValue,
      textValue: pricingConfig.textValue,
      description: pricingConfig.description,
    })
    .from(pricingConfig)
    .where(eq(pricingConfig.key, key))
    .limit(1);
  return row;
}

/**
 * Fetch a numeric config value as a JS number.
 * Returns null when the row is missing or numericValue is null (not seeded).
 */
export async function getConfigNumber(key: string): Promise<number | null> {
  const row = await getConfigRow(key);
  if (row?.numericValue === undefined || row.numericValue === null) return null;
  const n = parseFloat(row.numericValue);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch all pricing_config rows (admin list endpoint).
 */
export async function getAllConfigRows(): Promise<PricingConfigRow[]> {
  return db
    .select({
      key: pricingConfig.key,
      numericValue: pricingConfig.numericValue,
      textValue: pricingConfig.textValue,
      description: pricingConfig.description,
    })
    .from(pricingConfig)
    .orderBy(pricingConfig.key);
}

/**
 * Upsert a pricing_config row. Admin-only; call only from adminProcedure.
 */
export async function upsertConfigRow(
  key: string,
  numericValue: string | null,
  textValue: string | null,
  description: string | null,
  adminUserId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(pricingConfig)
    .values({
      key,
      numericValue: numericValue ?? null,
      textValue: textValue ?? null,
      description: description ?? null,
      createdAt: now,
      lastUpdAt: now,
      createdBy: adminUserId,
      lastUpdBy: adminUserId,
    })
    .onConflictDoUpdate({
      target: pricingConfig.key,
      set: {
        numericValue: numericValue ?? null,
        textValue: textValue ?? null,
        description: description ?? null,
        lastUpdAt: now,
        lastUpdBy: adminUserId,
      },
    });
}

/**
 * Unset-real-cost guard (S5 acceptance criterion).
 * Call from any endpoint that serves a live BRL price. Throws
 * INTERNAL_SERVER_ERROR when 'real_cost_per_unit' is not yet seeded so the
 * system never exposes a zero/placeholder price.
 */
export async function requireRealCostPerUnit(): Promise<number> {
  const value = await getConfigNumber(CONFIG_KEYS.REAL_COST_PER_UNIT);
  if (value === null) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Configuração de custo real por unidade não definida. " +
        "Execute `pnpm eval` e configure real_cost_per_unit antes de expor preços ao usuário.",
    });
  }
  return value;
}
