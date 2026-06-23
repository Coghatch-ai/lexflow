import { useState, useEffect, useCallback, type ReactElement, type FormEvent } from 'react';
import { Check, Bug, RefreshCw, X } from 'lucide-react';
import { useGetToken, useSession } from '../auth';
import {
  ISSUE_KINDS,
  githubIssueInputSchema,
  appendRequester,
  type GithubIssueInput,
} from '@shared/domain/github-issue';
import {
  createIssue,
  listOpenIssues,
  closeIssue,
  type CreateIssueResult,
  type IssueListItem,
} from '../shared/lib/issue-service';
import { AdminGate } from './admin-gate';

const BLANK: GithubIssueInput = { title: '', body: '', kind: 'bug' };

function IssueForm(): ReactElement {
  const getToken = useGetToken();
  const { user } = useSession();
  const [form, setForm] = useState<GithubIssueInput>(BLANK);
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<CreateIssueResult | null>(null);
  const [pending, setPending] = useState(false);

  function setField<K extends keyof GithubIssueInput>(key: K, value: GithubIssueInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setCreated(null);
    const result = githubIssueInputSchema.safeParse(form);
    if (!result.success) {
      setErrors(result.error.issues.map((i) => i.message));
      return;
    }
    setPending(true);
    try {
      const token = await getToken();
      const payload = {
        ...result.data,
        body: appendRequester(result.data.body, user?.email ?? ''),
      };
      const issue = await createIssue(payload, token);
      setCreated(issue);
      setForm(BLANK);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Erro desconhecido']);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-ink-mute">
        Abra uma issue no repositório do projeto (bugs, melhorias ou feedback do beta).
      </p>

      {created !== null && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>Issue #{created.number} criada.</span>
        </div>
      )}

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
        {errors.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-1">
            {errors.map((msg, i) => <p key={i}>{msg}</p>)}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Tipo</label>
          <select
            value={form.kind}
            onChange={(e) => { setField('kind', e.target.value as GithubIssueInput['kind']); }}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            {ISSUE_KINDS.map((k) => (
              <option key={k.code} value={k.code}>{k.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Título <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => { setField('title', e.target.value); }}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            placeholder="Resumo curto do problema"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Descrição <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={8}
            value={form.body}
            onChange={(e) => { setField('body', e.target.value); }}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            placeholder="Passos para reproduzir, comportamento esperado, etc. (Markdown suportado)"
            required
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] disabled:opacity-60 transition-colors"
        >
          <Bug className="w-4 h-4" />
          {pending ? 'Criando...' : 'Criar Issue'}
        </button>
      </form>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
}

function OpenIssuesList(): ReactElement {
  const getToken = useGetToken();
  const [issues, setIssues] = useState<IssueListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [closingNumber, setClosingNumber] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      setIssues(await listOpenIssues(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  const handleClose = useCallback(async (number: number) => {
    if (!window.confirm(`Fechar issue #${String(number)}?`)) return;
    setClosingNumber(number);
    setError(null);
    try {
      const token = await getToken();
      await closeIssue(number, token);
      setIssues((prev) => prev?.filter((it) => it.number !== number) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setClosingNumber(null);
    }
  }, [getToken]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">Issues abertas no repositório.</p>
        <button
          onClick={() => { void load(); }}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-ink-mute hover:text-ink disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {error !== null && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading && issues === null ? (
        <p className="text-sm text-ink-mute py-8 text-center">Carregando...</p>
      ) : (issues?.length ?? 0) === 0 ? (
        <p className="text-sm text-ink-mute py-8 text-center">Nenhuma issue aberta.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line overflow-hidden">
          {(issues ?? []).map((it) => (
            <li key={it.number} className="p-3 hover:bg-paper-sink transition-colors">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-ink-mute mt-0.5 shrink-0">#{it.number}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink">{it.title}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {it.labels.map((l) => (
                      <span key={l} className="px-1.5 py-0.5 rounded-full bg-paper-sink text-[0.65rem] text-ink-mute">
                        {l}
                      </span>
                    ))}
                    <span className="text-[0.65rem] text-ink-mute">{formatDate(it.createdAt)}</span>
                  </div>
                </div>
                <button
                  onClick={() => { void handleClose(it.number); }}
                  disabled={closingNumber !== null}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs font-medium text-ink-mute hover:text-red-600 disabled:opacity-50 transition-colors"
                >
                  <X className={`w-3.5 h-3.5 ${closingNumber === it.number ? 'animate-spin' : ''}`} />
                  {closingNumber === it.number ? 'Fechando...' : 'Fechar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type IssuesTab = 'create' | 'list';

function IssuesPanel(): ReactElement {
  const [tab, setTab] = useState<IssuesTab>('create');
  const tabs: Array<{ id: IssuesTab; label: string }> = [
    { id: 'create', label: 'Criar' },
    { id: 'list', label: 'Abertas' },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-line">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-[#d9ab53] text-ink' : 'border-transparent text-ink-mute hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'create' ? <IssueForm /> : <OpenIssuesList />}
    </div>
  );
}

export function AdminIssuesPage(): ReactElement {
  return <AdminGate><IssuesPanel /></AdminGate>;
}
