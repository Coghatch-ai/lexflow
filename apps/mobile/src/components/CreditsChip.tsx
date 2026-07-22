// apps/mobile/src/components/CreditsChip.tsx
//
// Balance chip + coupon redemption. Coupons are the only user-facing top-up
// until a purchase flow exists. Tap the chip → inline code input → redeem →
// balance refresh. Errors come pt-BR from the server (invalid/exhausted/
// expired/already-redeemed).

import { useState, type ReactElement } from "react";
import { Coins } from "lucide-react";
import { trpc } from "../lib/trpc";

export function CreditsChip(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const utils = trpc.useUtils();
  const balanceQ = trpc.credits.balance.useQuery();
  const redeemMut = trpc.credits.redeem.useMutation();

  if (balanceQ.data === undefined) return null;

  function redeem(): void {
    const trimmed = code.trim();
    if (trimmed.length === 0 || redeemMut.isPending) return;
    setMessage(null);
    redeemMut.mutate(
      { code: trimmed },
      {
        onSuccess: ({ granted }) => {
          setCode("");
          setMessage({ tone: "pos", text: `+${String(granted)} créditos!` });
          void utils.credits.balance.invalidate();
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
        className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold tnum text-ink active:opacity-70"
      >
        <Coins className="h-3.5 w-3.5 text-seal" strokeWidth={1.75} />
        {balanceQ.data.balance} créditos
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
