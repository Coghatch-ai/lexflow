// app/src/shared/components/AllowanceChip.tsx
//
// Compact balance pill for CORE AI surfaces (phase-1 explanation + phase-2 grading
// → allowance_ledger). The allowance balance read endpoint does not yet exist on the
// user-facing tRPC router — this chip renders a placeholder until it is added
// (flagged in #54 implementation report). No hardcoded numbers.

import type { ReactElement } from "react";
import { Zap } from "lucide-react";

interface AllowanceChipProps {
  /** Compact mode: icon only. Default: false. */
  compact?: boolean;
}

// NOTE: allowance balance read procedure is missing from the user-facing tRPC router.
// This chip renders a static placeholder until `credits.allowanceBalance` (or equivalent)
// is added by a backend slice. See #54 implementation report — flagged as missing endpoint.
export default function AllowanceChip({ compact = false }: AllowanceChipProps): ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border border-[var(--ink-line)] bg-paper text-ink-mute transition-colors"
      title="Saldo de IA principal (allowance) — leitura pendente de endpoint backend"
    >
      <Zap className="w-3.5 h-3.5 shrink-0" />
      {!compact && <span className="font-normal">IA principal</span>}
      <span className="opacity-50">—</span>
    </span>
  );
}
