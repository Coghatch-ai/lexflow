// scripts/mint-coupon.ts
//
// Mint a credit coupon from the CLI (until an admin UI exists). Coupons are
// the only user-facing top-up path (no auto signup grant — farmable).
//
//   pnpm db:mint-coupon <valueCredits> [maxRedemptions=1] [code] [note...]
//
// Prints the (generated or given) code. Code format XXXX-XXXX, uppercase, no
// lookalikes (no I/O/0/1).

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { coupons } from "../drizzle/schema";
import { COUPON_ALPHABET, COUPON_CODE_REGEX, normalizeCouponCode } from "../shared/domain/credits";

function randomCouponCode(): string {
  const pick = (): string => {
    const bytes = randomBytes(4);
    let out = "";
    for (const b of bytes) out += COUPON_ALPHABET[b % COUPON_ALPHABET.length] ?? "A";
    return out;
  };
  return `${pick()}-${pick()}`;
}

async function main(): Promise<void> {
  const [valueRaw, maxRaw, codeRaw, ...noteParts] = process.argv.slice(2);
  const valueCredits = Number(valueRaw);
  if (!Number.isInteger(valueCredits) || valueCredits <= 0) {
    console.error("usage: pnpm db:mint-coupon <valueCredits> [maxRedemptions=1] [code] [note...]");
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

  const connectionString =
    process.env["DATABASE_URL"] ??
    `postgresql://${process.env["DB_USER"]}:${process.env["DB_PASSWORD"]}@${process.env["DB_HOST"]}:${process.env["DB_PORT"] ?? "5432"}/${process.env["DB_NAME"]}`;
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool);

  const inserted = await db
    .insert(coupons)
    .values({
      code,
      valueCredits,
      maxRedemptions,
      note: noteParts.length > 0 ? noteParts.join(" ") : null,
    })
    .onConflictDoNothing({ target: coupons.code })
    .returning({ code: coupons.code });
  await pool.end();

  if (inserted.length === 0) {
    console.error(`coupon ${code} already exists`);
    process.exit(1);
  }
  console.warn(
    `minted ${code} — ${String(valueCredits)} credits × ${String(maxRedemptions)} redemptions`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
