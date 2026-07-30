// app/src/pages/BillingPage.tsx
//
// Billing / account screen (S7 — issue #54).
// Shows: subscription plan status, credit balance, allowance balance, redeem coupon.
// Credit history (ledger) hidden from this view per issue #63 — display-only.
//
// Reads (D4 — one unified wallet):
//   credits.wallet             → {percent: number, periodEnd: string | null} (fuel gauge)
//   credits.subscriptionStatus → {plan, status, currentPeriodStart, currentPeriodEnd}
//   credits.redeem             → mutation (all 3 kinds)

import type { ReactElement } from 'react';
import { CreditCard, Zap } from 'lucide-react';
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

// ── BillingPage (default export) ──────────────────────────────────────────────

export default function BillingPage(): ReactElement {
  const walletQuery = trpc.credits.wallet.useQuery();
  const subscriptionQuery = trpc.credits.subscriptionStatus.useQuery();
  const utils = trpc.useUtils();

  function handleRedeemSuccess(): void {
    void utils.credits.wallet.invalidate();
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
    </div>
  );
}
