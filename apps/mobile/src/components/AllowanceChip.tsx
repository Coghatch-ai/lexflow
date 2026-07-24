// apps/mobile/src/components/AllowanceChip.tsx
//
// Compact pill for CORE AI surfaces (phase-1 explanation + phase-2 grading →
// allowance_ledger). The allowance balance read endpoint does not yet exist on
// the user-facing tRPC router — this chip renders a placeholder until it is added.
// No hardcoded numbers. See #54 implementation report for the missing endpoint.

import type { ReactElement } from "react";
import { Zap } from "lucide-react";

// NOTE: allowance balance read procedure is missing from the user-facing tRPC router.
// Renders a placeholder until `credits.allowanceBalance` (or equivalent) is added.
export function AllowanceChip(): ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-1 text-[0.7rem] font-semibold text-ink-mute"
      title="Saldo de IA principal — disponível em breve"
    >
      <Zap className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      IA principal: —
    </span>
  );
}
