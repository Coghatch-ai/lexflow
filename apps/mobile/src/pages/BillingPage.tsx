// apps/mobile/src/pages/BillingPage.tsx
//
// Billing / account screen for the mobile PWA (S7 — issue #54).
// Plan status, both balances (credits + allowance placeholder), redeem coupon,
// credit ledger. pt-BR. No hardcoded prices.
//
// Reads:
//   credits.balance  → {balance, costs}
//   credits.ledger   → rows newest first (limit 50)
//   credits.redeem   → mutation (all 3 coupon kinds)
//
// Missing backend read endpoints (flagged, not added per #54 constraint):
//   allowance balance → no user-facing tRPC procedure
//   subscription status → no user-facing tRPC procedure

import { useState, type ReactElement } from "react";
import { ArrowDownLeft, ArrowUpRight, CreditCard, Coins, Tag, Zap } from "lucide-react";
import { trpc } from "../lib/trpc";
import type { CouponKind } from "@shared/domain/coupons";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    tutor: "Assistente IA",
    coach: "Análise do Coach",
    coupon_grant: "Cupom resgatado",
    admin_grant: "Crédito admin",
    refund: "Estorno",
  };
  return map[action] ?? action;
}

function kindMessage(kind: CouponKind, granted: number): string {
  if (kind === "credits") {
    return `+${String(granted)} crédito${granted === 1 ? "" : "s"} adicionado${granted === 1 ? "" : "s"}!`;
  }
  if (kind === "allowance") {
    return `+${String(granted)} uso${granted === 1 ? "" : "s"} de IA principal adicionado${granted === 1 ? "" : "s"}!`;
  }
  return `Assinatura ativada por ${String(granted)} ${granted === 1 ? "mês" : "meses"}!`;
}

// ── RedeemForm ────────────────────────────────────────────────────────────────

interface RedeemFormProps {
  onSuccess: () => void;
}

function RedeemForm({ onSuccess }: RedeemFormProps): ReactElement {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const redeemMut = trpc.credits.redeem.useMutation({
    onSuccess: ({ kind, granted }) => {
      setCode("");
      setMsg({ tone: "pos", text: kindMessage(kind, granted) });
      onSuccess();
    },
    onError: (err) => {
      setMsg({ tone: "neg", text: err.message });
    },
  });

  function submit(): void {
    const trimmed = code.trim();
    if (trimmed.length === 0 || redeemMut.isPending) return;
    setMsg(null);
    redeemMut.mutate({ code: trimmed });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Tag className="h-4 w-4 text-ink-soft" />
        <p className="text-sm font-semibold text-ink">Resgatar cupom</p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          maxLength={9}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="XXXX-XXXX"
          spellCheck={false}
          aria-label="Código do cupom"
          className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-3 py-2 text-sm font-mono text-ink uppercase placeholder:text-ink-mute focus:outline-none focus:border-seal"
        />
        <button
          type="button"
          disabled={code.trim().length === 0 || redeemMut.isPending}
          onClick={submit}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40 active:opacity-70"
        >
          {redeemMut.isPending ? "…" : "Resgatar"}
        </button>
      </div>
      {msg !== null && (
        <p className={`text-xs font-medium ${msg.tone === "pos" ? "text-pos" : "text-neg"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ── BillingPage ───────────────────────────────────────────────────────────────

export function BillingPage(): ReactElement {
  const utils = trpc.useUtils();
  const balanceQ = trpc.credits.balance.useQuery();
  const ledgerQ = trpc.credits.ledger.useQuery();

  function invalidate(): void {
    void utils.credits.balance.invalidate();
    void utils.credits.ledger.invalidate();
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-6 pb-24">
      <h1 className="font-display text-2xl font-bold text-ink">Conta &amp; Créditos</h1>

      {/* Plan — placeholder until subscription read endpoint exists */}
      <section className="rounded-xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-ink-soft" />
          <p className="text-sm font-semibold text-ink">Plano</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-mute">
            Ative um cupom de assinatura para acessar a IA principal sem limite diário.
          </p>
          <span className="shrink-0 ml-3 rounded-full border border-line bg-paper px-2.5 py-1 text-[0.7rem] font-semibold text-ink-mute">
            Gratuito
          </span>
        </div>
      </section>

      {/* Balances */}
      <section className="grid grid-cols-2 gap-3">
        {/* Credit balance — wired */}
        <div className="rounded-xl border border-line bg-surface p-4 space-y-1">
          <div className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-seal" strokeWidth={1.75} />
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-mute">
              Créditos
            </p>
          </div>
          <p className="font-display text-3xl font-bold tnum leading-none text-ink">
            {balanceQ.isLoading ? "…" : (balanceQ.data?.balance ?? "—")}
          </p>
          <p className="text-[0.65rem] text-ink-mute">Assistente &amp; coach</p>
        </div>

        {/* Allowance balance — placeholder */}
        <div className="rounded-xl border border-line bg-surface p-4 space-y-1 opacity-60">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.75} />
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-mute">
              IA Principal
            </p>
          </div>
          <p className="font-display text-3xl font-bold tnum leading-none text-ink-mute">—</p>
          <p className="text-[0.65rem] text-ink-mute">Disponível em breve</p>
        </div>
      </section>

      {/* Redeem coupon */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <RedeemForm onSuccess={invalidate} />
      </section>

      {/* Ledger */}
      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-sm font-semibold text-ink">Histórico de créditos</p>
        </div>
        {ledgerQ.isLoading ? (
          <p className="px-4 py-6 text-sm text-ink-mute text-center">Carregando…</p>
        ) : (ledgerQ.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-mute text-center">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(ledgerQ.data ?? []).map((row) => {
              const isCredit = row.delta > 0;
              return (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      isCredit ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    }`}
                  >
                    {isCredit ? (
                      <ArrowDownLeft className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {actionLabel(row.action)}
                    </p>
                    {row.note !== null && (
                      <p className="truncate text-xs text-ink-mute">{row.note}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-sm font-semibold tnum ${
                        isCredit ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {isCredit ? "+" : ""}
                      {row.delta}
                    </p>
                    <p className="text-[0.65rem] text-ink-mute">{fmtDate(row.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
