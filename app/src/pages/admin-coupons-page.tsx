import { useState, type ReactElement } from 'react';
import { Ticket, Copy, Check } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { AdminGate } from './admin-gate';
import { COUPON_KINDS, type CouponKind } from '@shared/domain/coupons';

const KIND_LABELS: Record<CouponKind, string> = {
  credits: 'Créditos',
  allowance: 'Franquia',
  subscription: 'Assinatura',
};

// Per-kind label for the single value field + which backing field it maps to.
const VALUE_FIELD_LABELS: Record<CouponKind, string> = {
  credits: 'Créditos concedidos',
  allowance: 'Unidades de franquia',
  subscription: 'Meses de assinatura',
};

type MintForm = {
  kind: CouponKind;
  value: string;
  code: string;
  maxRedemptions: string;
  expiresAt: string;
  note: string;
};

const EMPTY_FORM: MintForm = {
  kind: 'credits',
  value: '',
  code: '',
  maxRedemptions: '1',
  expiresAt: '',
  note: '',
};

function parsePositiveInt(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

// Map the single value field onto the kind-specific backing field the router expects.
function buildValuePayload(kind: CouponKind, value: number): {
  valueCredits?: number;
  valueUnits?: number;
  valuePeriodMonths?: number;
} {
  if (kind === 'credits') return { valueCredits: value };
  if (kind === 'allowance') return { valueUnits: value };
  return { valuePeriodMonths: value };
}

function CreatedCodeBanner({ code, kind }: { code: string; kind: CouponKind }): ReactElement {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    });
  }

  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
          Cupom criado · {KIND_LABELS[kind]}
        </p>
        <p className="mt-1 font-mono text-2xl font-bold text-emerald-900">{code}</p>
      </div>
      <button
        onClick={copy}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function MintFormCard(): ReactElement {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<MintForm>({ ...EMPTY_FORM });
  const [created, setCreated] = useState<{ code: string; kind: CouponKind } | null>(null);

  const mintMutation = trpc.credits.mintCoupon.useMutation({
    onSuccess: (res) => {
      setCreated(res);
      setForm({ ...EMPTY_FORM });
      void utils.credits.listCoupons.invalidate();
    },
  });

  function set<K extends keyof MintForm>(field: K, value: MintForm[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit() {
    const value = parsePositiveInt(form.value);
    const maxRedemptions = parsePositiveInt(form.maxRedemptions);
    mintMutation.mutate({
      kind: form.kind,
      ...buildValuePayload(form.kind, value),
      maxRedemptions: maxRedemptions > 0 ? maxRedemptions : 1,
      code: form.code.trim() !== '' ? form.code.trim() : undefined,
      expiresAt: form.expiresAt !== '' ? new Date(form.expiresAt).toISOString() : undefined,
      note: form.note.trim() !== '' ? form.note.trim() : undefined,
    });
  }

  const isDisabled = mintMutation.isPending || parsePositiveInt(form.value) <= 0;

  return (
    <div className="space-y-4">
      {created !== null && <CreatedCodeBanner code={created.code} kind={created.kind} />}

      <div className="border border-line rounded-xl p-5 space-y-4 bg-white">
        <h3 className="font-semibold text-ink">Novo Cupom</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Tipo</label>
            <select
              value={form.kind}
              onChange={(e) => { set('kind', e.target.value as CouponKind); }}
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            >
              {COUPON_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">{VALUE_FIELD_LABELS[form.kind]}</label>
            <input
              type="number"
              min={1}
              value={form.value}
              onChange={(e) => { set('value', e.target.value); }}
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Código (opcional)</label>
            <input
              value={form.code}
              onChange={(e) => { set('code', e.target.value); }}
              placeholder="Deixe em branco para gerar automaticamente"
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Máx. resgates</label>
            <input
              type="number"
              min={1}
              value={form.maxRedemptions}
              onChange={(e) => { set('maxRedemptions', e.target.value); }}
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Expira em (opcional)</label>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => { set('expiresAt', e.target.value); }}
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Nota (opcional)</label>
            <input
              value={form.note}
              onChange={(e) => { set('note', e.target.value); }}
              placeholder="Ex: campanha de lançamento"
              className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
            />
          </div>
        </div>

        {mintMutation.error !== null && (
          <p className="text-sm text-red-600">{mintMutation.error.message}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors disabled:opacity-50"
        >
          {mintMutation.isPending ? 'Criando...' : 'Criar Cupom'}
        </button>
      </div>
    </div>
  );
}

function couponValueText(row: {
  kind: string;
  valueCredits: number;
  valueUnits: number;
  valuePeriodMonths: number;
}): string {
  if (row.kind === 'credits') return `${row.valueCredits} créditos`;
  if (row.kind === 'allowance') return `${row.valueUnits} unidades`;
  return `${row.valuePeriodMonths} meses`;
}

function CouponList(): ReactElement {
  const listQuery = trpc.credits.listCoupons.useQuery();

  if (listQuery.isLoading) {
    return <div className="flex items-center justify-center h-24 text-ink-mute">Carregando...</div>;
  }

  const rows = listQuery.data ?? [];
  if (rows.length === 0) {
    return <div className="text-center py-12 text-ink-mute text-sm">Nenhum cupom criado ainda.</div>;
  }

  return (
    <div className="border border-line rounded-xl overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold text-ink-mute uppercase tracking-wide">
            <th className="px-4 py-3">Código</th>
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Resgates</th>
            <th className="px-4 py-3">Expira</th>
            <th className="px-4 py-3">Nota</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-3 font-mono font-semibold text-ink">{row.code}</td>
              <td className="px-4 py-3 text-ink-soft">{KIND_LABELS[row.kind as CouponKind]}</td>
              <td className="px-4 py-3 text-ink-soft">{couponValueText(row)}</td>
              <td className="px-4 py-3 text-ink-soft">{row.redeemedCount}/{row.maxRedemptions}</td>
              <td className="px-4 py-3 text-ink-soft">
                {row.expiresAt !== null ? new Date(row.expiresAt).toLocaleDateString('pt-BR') : '—'}
              </td>
              <td className="px-4 py-3 text-ink-mute">{row.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CouponsAdmin(): ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-ink-mute">
        <Ticket className="w-4 h-4" />
        <p className="text-sm">Crie e gerencie cupons de créditos, franquia e assinatura.</p>
      </div>
      <MintFormCard />
      <CouponList />
    </div>
  );
}

export function AdminCouponsPage(): ReactElement {
  return <AdminGate><CouponsAdmin /></AdminGate>;
}
