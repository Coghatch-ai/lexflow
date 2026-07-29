// app/src/pages/BillingPage.tsx
//
// Billing / account screen (S7 — issue #54).
// Shows: subscription plan status, credit balance, allowance balance, ledger/history,
// redeem coupon.
//
// Reads (D4 — one unified wallet):
//   credits.wallet             → {percent: number, periodEnd: string | null} (fuel gauge)
//   credits.ledger             → ledger rows (newest first, limit 50)
//   credits.subscriptionStatus → {plan, status, currentPeriodStart, currentPeriodEnd}
//   credits.redeem             → mutation (all 3 kinds)

import type { ReactElement } from 'react';
import { CreditCard, Zap, Tag, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
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

interface PlanCardProps {
  plan: string | undefined;
  status: string | undefined;
  periodEnd: string | null | undefined;
  isLoading: boolean;
}

function planLabel(plan: string | undefined): string {
  if (plan === 'paid') return 'Premium';
  if (plan === 'free' || plan === undefined) return 'Gratuito';
  return plan;
}

function statusLabel(status: string | undefined): string {
  if (status === 'active') return 'Ativo';
  if (status === 'canceled') return 'Cancelado';
  if (status === 'past_due') return 'Em atraso';
  return '—';
}

function PlanCard({ plan, status, periodEnd, isLoading }: PlanCardProps): ReactElement {
  const isPaid = plan === 'paid' && status === 'active';
  return (
    <div className="rounded-xl border border-line bg-surface p-6 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-ink-soft" />
        <h3 className="font-display text-base font-bold text-ink">Plano</h3>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-mute">Status da assinatura</p>
          {isLoading ? (
            <p className="mt-1 text-sm text-ink-soft">Carregando…</p>
          ) : isPaid ? (
            <p className="mt-1 text-sm text-ink">
              {statusLabel(status)}
              {periodEnd !== null && periodEnd !== undefined
                ? ` — válido até ${formatDate(periodEnd)}`
                : ''}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft italic">
              Ative um cupom de assinatura para começar.
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
            isPaid
              ? 'border-seal-bright bg-seal-pale text-seal-bright'
              : 'border-line bg-paper text-ink-mute'
          }`}
        >
          {isLoading ? '…' : planLabel(plan)}
        </span>
      </div>
    </div>
  );
}

interface WalletCardProps {
  percent: number | undefined;
  periodEnd: string | null | undefined;
  isLoading: boolean;
}

// One unified wallet fuel gauge (D4). The server sends a percent [0,100] only —
// no magnitude reaches the client, and the client never recomputes reset logic.
function WalletCard({ percent, periodEnd, isLoading }: WalletCardProps): ReactElement {
  const pct = percent ?? 0;
  const isLow = percent !== undefined && percent <= 15;
  return (
    <div className="rounded-xl border border-line bg-surface p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-seal-bright" />
        <p className="eyebrow">Saldo de IA</p>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-paper border border-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Saldo de IA"
      >
        <div
          className={`h-full rounded-full transition-all ${isLow ? 'bg-red-500' : 'bg-seal-bright'}`}
          style={{ width: `${String(isLoading ? 0 : pct)}%` }}
        />
      </div>
      <p className="text-xs text-ink-mute">
        {isLoading
          ? 'Carregando…'
          : periodEnd !== null && periodEnd !== undefined
            ? `${String(pct)}% — período até ${formatDate(periodEnd)}`
            : `${String(pct)}% do seu saldo de IA`}
      </p>
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
  const walletQuery = trpc.credits.wallet.useQuery();
  const ledgerQuery = trpc.credits.ledger.useQuery();
  const subscriptionQuery = trpc.credits.subscriptionStatus.useQuery();
  const utils = trpc.useUtils();

  function handleRedeemSuccess(): void {
    void utils.credits.wallet.invalidate();
    void utils.credits.ledger.invalidate();
    void utils.credits.subscriptionStatus.invalidate();
  }

  return (
    <div className="space-y-6">
      <PlanCard
        plan={subscriptionQuery.data?.plan}
        status={subscriptionQuery.data?.status}
        periodEnd={subscriptionQuery.data?.currentPeriodEnd}
        isLoading={subscriptionQuery.isLoading}
      />

      <WalletCard
        percent={walletQuery.data?.percent}
        periodEnd={walletQuery.data?.periodEnd}
        isLoading={walletQuery.isLoading}
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
