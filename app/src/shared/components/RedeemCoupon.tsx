// app/src/shared/components/RedeemCoupon.tsx
//
// Self-contained coupon redemption input. Handles all three coupon kinds
// (credits | allowance | subscription) via credits.redeem and shows a
// pt-BR success message tailored to each kind. Reusable — drop anywhere.

import { useState, type ReactElement } from "react";
import { Tag } from "lucide-react";
import { trpc } from "../lib/trpc";
import { normalizeCouponCode, isValidCouponCode } from "@shared/domain/credits";
import type { CouponKind } from "@shared/domain/coupons";

function successMessage(kind: CouponKind, granted: number): string {
  if (kind === "credits") {
    return `Cupom resgatado! ${granted} crédito${granted === 1 ? "" : "s"} adicionado${granted === 1 ? "" : "s"} à sua conta.`;
  }
  if (kind === "allowance") {
    return `Cupom resgatado! ${granted} uso${granted === 1 ? "" : "s"} de IA principal adicionado${granted === 1 ? "" : "s"} ao seu saldo.`;
  }
  // subscription
  return `Cupom resgatado! Assinatura ativada por ${granted} ${granted === 1 ? "mês" : "meses"}.`;
}

interface RedeemCouponProps {
  /** Called after a successful redemption so the parent can invalidate queries. */
  onSuccess?: () => void;
  /** Visual size variant. Default: 'default'. */
  size?: "default" | "compact";
}

export default function RedeemCoupon({
  onSuccess,
  size = "default",
}: RedeemCouponProps): ReactElement {
  const [code, setCode] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const redeemMut = trpc.credits.redeem.useMutation({
    onSuccess: (data) => {
      const msg = successMessage(data.kind, data.granted);
      setSuccessMsg(msg);
      setErrorMsg(null);
      setCode("");
      void utils.credits.balance.invalidate();
      void utils.credits.ledger.invalidate();
      onSuccess?.();
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setSuccessMsg(null);
    },
  });

  const normalized = normalizeCouponCode(code);
  const valid = isValidCouponCode(normalized);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!valid || redeemMut.isPending) return;
    setSuccessMsg(null);
    setErrorMsg(null);
    redeemMut.mutate({ code: normalized });
  }

  const isCompact = size === "compact";

  return (
    <div className={isCompact ? "space-y-1.5" : "space-y-2"}>
      {!isCompact && (
        <div className="flex items-center gap-1.5 mb-1">
          <Tag className="w-4 h-4 text-ink-soft" />
          <span className="text-sm font-semibold text-ink">Resgatar cupom</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setSuccessMsg(null);
            setErrorMsg(null);
          }}
          placeholder="XXXX-XXXX"
          maxLength={9}
          spellCheck={false}
          aria-label="Código do cupom"
          className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono text-ink placeholder-ink-mute focus:outline-none focus:border-seal-bright focus:ring-1 focus:ring-seal-bright/30 transition"
        />
        <button
          type="submit"
          disabled={!valid || redeemMut.isPending}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface transition hover:bg-ink-raised disabled:opacity-40"
        >
          {redeemMut.isPending ? "Aguarde…" : "Resgatar"}
        </button>
      </form>
      {successMsg !== null && (
        <p className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {successMsg}
        </p>
      )}
      {errorMsg !== null && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
