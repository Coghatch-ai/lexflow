// app/src/shared/components/CreditsChip.tsx
//
// Compact balance pill for NON-CORE AI surfaces (tutor / coach → credit_ledger).
// Shows current credit balance from credits.balance. No hardcoded numbers.
// Rendered near any surface that draws credits so the user sees cost before acting.

import type { ReactElement } from "react";
import { Coins } from "lucide-react";
import { trpc } from "../lib/trpc";

interface CreditsChipProps {
  /** Compact mode: icon + number only (no label). Default: false. */
  compact?: boolean;
}

export default function CreditsChip({ compact = false }: CreditsChipProps): ReactElement {
  const query = trpc.credits.balance.useQuery();
  const balance = query.data?.balance;

  const isEmpty = balance !== undefined && balance <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border transition-colors ${
        isEmpty
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-seal-bright/30 bg-seal-wash text-seal-bright"
      }`}
      title="Saldo de créditos"
    >
      <Coins className="w-3.5 h-3.5 shrink-0" />
      {query.isLoading ? (
        <span className="opacity-50">…</span>
      ) : balance === undefined ? (
        <span className="opacity-50">—</span>
      ) : (
        <>
          <span>{balance}</span>
          {!compact && <span className="font-normal opacity-70">créditos</span>}
        </>
      )}
    </span>
  );
}
