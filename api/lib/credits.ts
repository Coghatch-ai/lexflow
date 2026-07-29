// api/lib/credits.ts
//
// Admin credit grant — the remaining credit-side helper after the no-legacy
// cutover (D4, epic #50). Spend/refund/admission are DELETED: spend is metered
// post-delivery through the money core charge() (api/lib/ai-metering.ts), and
// admission reads credit_balances (api/lib/admission.ts). The only thing left here
// is the admin grant, routed through the single writer grant().

import { grant } from "./credit-charge";

// Idempotent positive admin grant. refId dedupes replays. Routed through the money
// core grant() (kind=grant, source=admin) so credit_ledger + credit_balances are
// updated in one tx by the single writer.
export async function grantCredits(
  userId: string,
  credits: number,
  _action: "admin_grant",
  refId: string,
  _note?: string,
): Promise<void> {
  await grant({
    scope: { userId },
    cents: credits,
    source: "admin",
    refId,
    kind: "grant",
  });
}
