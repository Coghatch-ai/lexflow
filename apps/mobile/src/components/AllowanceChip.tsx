// apps/mobile/src/components/AllowanceChip.tsx
//
// Wallet fuel gauge pill (D4, epic #50). One unified wallet — reads credits.wallet
// (server-computed percent [0,100], no magnitude, no client reset logic).

import type { ReactElement } from "react";
import { Fuel } from "lucide-react";
import { trpc } from "../lib/trpc";

export function AllowanceChip(): ReactElement {
  const { data, isLoading } = trpc.credits.wallet.useQuery();
  const percent = data?.percent;
  const isLow = percent !== undefined && percent <= 15;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
        isLow ? "border-red-300 bg-red-50 text-red-700" : "border-line bg-paper text-ink-mute"
      }`}
      title="Saldo de IA"
    >
      <Fuel className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      {isLoading || percent === undefined ? (
        "…"
      ) : (
        <>
          <span
            className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Saldo de IA"
          >
            <span
              className={`block h-full rounded-full ${isLow ? "bg-red-500" : "bg-seal"}`}
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          {`${String(percent)}%`}
        </>
      )}
    </span>
  );
}
