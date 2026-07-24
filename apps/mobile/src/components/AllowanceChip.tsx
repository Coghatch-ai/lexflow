// apps/mobile/src/components/AllowanceChip.tsx
//
// Compact pill for CORE AI surfaces (phase-1 explanation + phase-2 grading →
// allowance_ledger). Wired to credits.allowanceBalance (#56).
// No hardcoded numbers — balance derived from ledger SUM via backend.

import type { ReactElement } from "react";
import { Zap } from "lucide-react";
import { trpc } from "../lib/trpc";

export function AllowanceChip(): ReactElement {
  const { data, isLoading } = trpc.credits.allowanceBalance.useQuery();

  const label = isLoading ? "…" : (data?.balance.toString() ?? "—");

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-1 text-[0.7rem] font-semibold text-ink-mute"
      title={`Saldo de IA principal: ${label} unidades`}
    >
      <Zap className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      {`IA principal: ${label}`}
    </span>
  );
}
