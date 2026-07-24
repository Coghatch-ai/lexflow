// app/src/pages/BillingPage.tsx
//
// Billing / account screen (S7 — issue #54).
// Shows: subscription plan status, credit balance, allowance balance (placeholder
// until backend read endpoint added — see #54 report), ledger/history, redeem coupon.
//
// Reads:
//   credits.balance  → {balance: number, costs: {tutor, coach}}
//   credits.ledger   → ledger rows (newest first, limit 50)
//   credits.redeem   → mutation (all 3 kinds)
//
// Missing backend read endpoints (flagged, not added per #54 constraint):
//   allowance balance → no user-facing tRPC procedure exists
//   subscription status → no user-facing tRPC procedure exists
// Both surfaces render a pt-BR placeholder/disabled state until those are added.

import type { ReactElement } from 'react';
import { CreditCard, Coins, Zap, Tag, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import RedeemCoupon from '../shared/components/RedeemCoupon';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    tutor: 'Assistente IA',
    coach: 'Análise do Coach',
    coupon_grant: 'Cupom resgatado',
    admin_grant: 'Crédito admin',
    refund: 'Estorno',
  };
  return map[action] ?? action;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PlanCard(): ReactElement {
  // Subscription status read endpoint is not yet available on the user-facing
  // tRPC router. Renders a placeholder until it is added.
  return (
    <div className="rounded-xl border border-line bg-surface p-6 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-ink-soft" />
        <h3 className="font-display text-base font-bold text-ink">Plano</h3>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-mute">Status da assinatura</p>
          <p className="mt-1 text-sm text-ink-soft italic">
            Disponível em breve — ative um cupom de assinatura para começar.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-paper px-3 py-1 text-xs font-semibold text-ink-mute">
          Gratuito
        </span>
      </div>
    </div>
  );
}

interface BalanceCardsProps {
  creditBalance: number | undefined;
  isLoading: boolean;
}

function BalanceCards({ creditBalance, isLoading }: BalanceCardsProps): ReactElement {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Credit balance — wired to credits.balance */}
      <div className="rounded-xl border border-line bg-surface p-6 space-y-2">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-seal-bright" />
          <p className="eyebrow">Créditos</p>
        </div>
        <p className="font-display text-4xl font-bold tabular-nums leading-none text-ink">
          {isLoading ? '…' : (creditBalance ?? '—')}
        </p>
        <p className="text-xs text-ink-mute">Para assistente e coach (não expira)</p>
      </div>

      {/* Allowance balance — missing backend read; placeholder */}
      <div className="rounded-xl border border-line bg-surface p-6 space-y-2 opacity-60">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-ink-soft" />
          <p className="eyebrow">IA Principal</p>
        </div>
        <p className="font-display text-4xl font-bold tabular-nums leading-none text-ink-mute">
          —
        </p>
        <p className="text-xs text-ink-mute">
          Saldo disponível em breve
        </p>
      </div>
    </div>
  );
}

type LedgerRow = {
  id: string;
  delta: number;
  action: string;
  note: string | null;
  createdAt: string | Date;
};

interface LedgerTableProps {
  rows: LedgerRow[];
  isLoading: boolean;
}

function LedgerTable({ rows, isLoading }: LedgerTableProps): ReactElement {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-line flex items-center gap-2">
        <Tag className="w-4 h-4 text-ink-soft" />
        <h3 className="font-display text-sm font-bold text-ink">Histórico de créditos</h3>
      </div>
      {isLoading ? (
        <p className="px-6 py-8 text-sm text-ink-mute text-center">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-ink-mute text-center">Nenhuma movimentação ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const isCredit = row.delta > 0;
            return (
              <li key={row.id} className="flex items-center gap-3 px-6 py-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isCredit ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {isCredit ? (
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{actionLabel(row.action)}</p>
                  {row.note !== null && (
                    <p className="truncate text-xs text-ink-mute">{row.note}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      isCredit ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {isCredit ? '+' : ''}{row.delta}
                  </p>
                  <p className="text-[0.65rem] text-ink-mute">{formatDate(row.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── BillingPage (default export) ──────────────────────────────────────────────

export default function BillingPage(): ReactElement {
  const balanceQuery = trpc.credits.balance.useQuery();
  const ledgerQuery = trpc.credits.ledger.useQuery();
  const utils = trpc.useUtils();

  function handleRedeemSuccess(): void {
    void utils.credits.balance.invalidate();
    void utils.credits.ledger.invalidate();
  }

  return (
    <div className="space-y-6">
      <PlanCard />

      <BalanceCards
        creditBalance={balanceQuery.data?.balance}
        isLoading={balanceQuery.isLoading}
      />

      {/* Redeem coupon */}
      <div className="rounded-xl border border-line bg-surface p-6">
        <RedeemCoupon onSuccess={handleRedeemSuccess} />
      </div>

      <LedgerTable
        rows={(ledgerQuery.data ?? []).map((r) => ({
          ...r,
          note: r.note ?? null,
          createdAt: r.createdAt,
        }))}
        isLoading={ledgerQuery.isLoading}
      />
    </div>
  );
}
