// app/src/shared/components/WalletGauge.tsx
//
// Fuel gauge for the unified credit wallet (D4, epic #50). The server computes a
// single integer percent [0,100] (credits.wallet) from the materialized balance
// and the reference anchor; this component only RENDERS that gauge. It never sees a
// raw magnitude (no cents/units) and never recomputes reset/percent logic — the
// client is deliberately dumb about money.

import type { ReactElement } from "react";
import { Fuel } from "lucide-react";
import { trpc } from "../lib/trpc";

interface WalletGaugeProps {
  /** Compact mode: icon + bar only (no percent label). Default: false. */
  compact?: boolean;
}

// Low-fuel threshold (display only — the real deny lives server-side in admission).
const LOW_PERCENT = 15;

export default function WalletGauge({ compact = false }: WalletGaugeProps): ReactElement {
  const { data, isLoading } = trpc.credits.wallet.useQuery();
  const percent = data?.percent;
  const isLow = percent !== undefined && percent <= LOW_PERCENT;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border transition-colors ${
        isLow
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-[var(--ink-line)] bg-paper text-ink-mute"
      }`}
      title="Saldo de IA"
    >
      <Fuel className="w-3.5 h-3.5 shrink-0" />
      {isLoading || percent === undefined ? (
        <span className="opacity-50">…</span>
      ) : (
        <>
          <span
            className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-[var(--ink-line)]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Saldo de IA"
          >
            <span
              className={`block h-full rounded-full ${isLow ? "bg-red-500" : "bg-seal-bright"}`}
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          {!compact && <span className="tabular-nums">{percent}%</span>}
        </>
      )}
    </span>
  );
}
