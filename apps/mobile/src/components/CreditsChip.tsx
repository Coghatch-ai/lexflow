// apps/mobile/src/components/CreditsChip.tsx
//
// Balance chip + coupon redemption. Coupons are the only user-facing top-up
// until a purchase flow exists. Tap the chip → inline code input → redeem →
// balance refresh. Handles all three coupon kinds (credits | allowance | subscription)
// with per-kind pt-BR success messages. Errors come pt-BR from the server
// (invalid/exhausted/expired/already-redeemed).

import { useState, type ReactElement } from "react";
import { Fuel } from "lucide-react";
import { trpc } from "../lib/trpc";
import type { CouponKind } from "@shared/domain/coupons";

function kindMessage(kind: CouponKind, granted: number): string {
  if (kind === "credits") {
    return `+${String(granted)} crédito${granted === 1 ? "" : "s"}!`;
  }
  if (kind === "allowance") {
    return `+${String(granted)} uso${granted === 1 ? "" : "s"} de IA principal!`;
  }
  // subscription
  return `Assinatura ativada por ${String(granted)} ${granted === 1 ? "mês" : "meses"}!`;
}

export function CreditsChip(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const utils = trpc.useUtils();
  const walletQ = trpc.credits.wallet.useQuery();
  const redeemMut = trpc.credits.redeem.useMutation();

  if (walletQ.data === undefined) return null;
  const pct = walletQ.data.percent;
  const isLow = pct <= 15;

  function redeem(): void {
    const trimmed = code.trim();
    if (trimmed.length === 0 || redeemMut.isPending) return;
    setMessage(null);
    redeemMut.mutate(
      { code: trimmed },
      {
        onSuccess: ({ kind, granted }) => {
          setCode("");
          setMessage({ tone: "pos", text: kindMessage(kind, granted) });
          void utils.credits.wallet.invalidate();
          void utils.credits.ledger.invalidate();
        },
        onError: (err) => {
          setMessage({ tone: "neg", text: err.message });
        },
      },
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setMessage(null);
        }}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tnum active:opacity-70 ${
          isLow ? "border-red-300 bg-red-50 text-red-700" : "border-line bg-surface text-ink"
        }`}
      >
        <Fuel className="h-3.5 w-3.5 text-seal" strokeWidth={1.75} />
        <span
          className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Saldo de IA"
        >
          <span
            className={`block h-full rounded-full ${isLow ? "bg-red-500" : "bg-seal"}`}
            style={{ width: `${String(pct)}%` }}
          />
        </span>
        {pct}%
      </button>
      {open ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={code}
            maxLength={9}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") redeem();
            }}
            placeholder="CUPOM-XXXX"
            className="w-32 rounded-lg border border-line-strong bg-paper px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink placeholder:text-ink-mute"
          />
          <button
            type="button"
            disabled={redeemMut.isPending || code.trim().length === 0}
            onClick={redeem}
            className="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-paper disabled:opacity-50 active:opacity-70"
          >
            {redeemMut.isPending ? "…" : "Resgatar"}
          </button>
        </div>
      ) : null}
      {message !== null ? (
        <p className={`text-[0.7rem] ${message.tone === "pos" ? "text-pos" : "text-neg"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
