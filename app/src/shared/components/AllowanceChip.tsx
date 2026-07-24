// app/src/shared/components/AllowanceChip.tsx
//
// Compact balance pill for CORE AI surfaces (phase-1 explanation + phase-2 grading
// → allowance_ledger). Wired to credits.allowanceBalance (#56).
// No hardcoded numbers — balance is derived from the ledger SUM via the backend.

import type { ReactElement } from "react";
import { Zap } from "lucide-react";
import { trpc } from "../lib/trpc";

interface AllowanceChipProps {
  /** Compact mode: icon only. Default: false. */
  compact?: boolean;
}

export default function AllowanceChip({ compact = false }: AllowanceChipProps): ReactElement {
  const { data, isLoading } = trpc.credits.allowanceBalance.useQuery();

  const label = isLoading ? "…" : (data?.balance.toString() ?? "—");

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border border-[var(--ink-line)] bg-paper text-ink-mute transition-colors"
      title={`Saldo de IA principal (allowance): ${label} unidades`}
    >
      <Zap className="w-3.5 h-3.5 shrink-0" />
      {!compact && <span className="font-normal">IA principal</span>}
      <span>{label}</span>
    </span>
  );
}
