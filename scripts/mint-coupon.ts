// scripts/mint-coupon.ts
//
// Mint a coupon from the CLI (until an admin UI exists). Coupons are
// the only user-facing top-up path (no auto signup grant — farmable).
//
//   pnpm db:mint-coupon <kind> <value> [maxRedemptions=1] [code] [note...]
//
// kind:
//   credits      — value = credits granted (integer)
//   allowance    — value = allowance units granted (integer)
//   subscription — value = period in months (integer)
//
// Prints the (generated or given) code. Code format XXXX-XXXX, uppercase, no
// lookalikes (no I/O/0/1).

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { coupons } from "../drizzle/schema";
import { COUPON_ALPHABET, COUPON_CODE_REGEX, normalizeCouponCode } from "../shared/domain/credits";
import { COUPON_KINDS, type CouponKind } from "../shared/domain/coupons";

function randomCouponCode(): string {
  const pick = (): string => {
    const bytes = randomBytes(4);
    let out = "";
    for (const b of bytes) out += COUPON_ALPHABET[b % COUPON_ALPHABET.length] ?? "A";
    return out;
  };
  return `${pick()}-${pick()}`;
}

function parseArgs(argv: string[]): {
  kind: CouponKind;
  value: number;
  maxRedemptions: number;
  code: string;
  note: string | null;
} {
  const [kindRaw, valueRaw, maxRaw, codeRaw, ...noteParts] = argv;

  const kind = kindRaw as CouponKind | undefined;
  if (kind === undefined || !COUPON_KINDS.includes(kind)) {
    console.error("usage: pnpm db:mint-coupon <kind> <value> [maxRedemptions=1] [code] [note...]");
    console.error(`  kind: ${COUPON_KINDS.join(" | ")}`);
    console.error("  value: credits (kind=credits), units (allowance), months (subscription)");
    process.exit(1);
  }

  const value = Number(valueRaw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`value must be a positive integer (got: ${String(valueRaw)})`);
    process.exit(1);
  }

  const maxRedemptions = maxRaw !== undefined ? Number(maxRaw) : 1;
  if (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0) {
    console.error("maxRedemptions must be a positive integer");
    process.exit(1);
  }

  const code = codeRaw !== undefined ? normalizeCouponCode(codeRaw) : randomCouponCode();
  if (!COUPON_CODE_REGEX.test(code)) {
    console.error(`invalid code format: ${code} (expected XXXX-XXXX, no I/O/0/1)`);
    process.exit(1);
  }

  return {
    kind,
    value,
    maxRedemptions,
    code,
    note: noteParts.length > 0 ? noteParts.join(" ") : null,
  };
}

function valueLabel(kind: CouponKind, value: number): string {
  if (kind === "credits") return `${String(value)} credits`;
  if (kind === "allowance") return `${String(value)} allowance units`;
  return `${String(value)} month(s) subscription`;
}

async function main(): Promise<void> {
  const { kind, value, maxRedemptions, code, note } = parseArgs(process.argv.slice(2));

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}:${process.env["DB_PORT"] ?? "5432"}/${process.env["DB_NAME"]}`;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool);

  const inserted = await db
    .insert(coupons)
    .values({
      code,
      kind,
      valueCredits: kind === "credits" ? value : 0,
      valueUnits: kind === "allowance" ? value : 0,
      valuePeriodMonths: kind === "subscription" ? value : 0,
      maxRedemptions,
      note,
    })
    .onConflictDoNothing({ target: coupons.code })
    .returning({ code: coupons.code });
  await pool.end();

  if (inserted.length === 0) {
    console.error(`coupon ${code} already exists`);
    process.exit(1);
  }

  console.warn(
    `minted ${code} — kind=${kind}, ${valueLabel(kind, value)} × ${String(maxRedemptions)} redemption(s)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
