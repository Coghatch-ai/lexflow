import { useState, useEffect, useCallback, useRef, type ReactElement, type FormEvent } from 'react';
import { Check, Bug, RefreshCw, X, Mail, MessageSquare, ExternalLink } from 'lucide-react';
import { useGetToken, useSession } from '../auth';
import {
  ISSUE_KINDS,
  githubIssueInputSchema,
  appendRequester,
  parseRequester,
  type GithubIssueInput,
} from '@shared/domain/github-issue';
import {
  createIssue,
  listOpenIssues,
  closeIssue,
  getIssue,
  type CreateIssueResult,
  type IssueListItem,
  type IssueDetailResult,
  type IssueComment,
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
}

// Body sans the "Solicitante" footer (surfaced separately as a chip below).
function bodyWithoutRequester(body: string): string {
  return body.split('\n\n---\nSolicitante:')[0] ?? body;
}

function CommentList({ comments }: { comments: IssueComment[] }): ReactElement | null {
  if (comments.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-mute">
        <MessageSquare className="w-3.5 h-3.5" />
        {comments.length} comentário{comments.length === 1 ? '' : 's'}
      </p>
      {comments.map((c) => (
        <div key={c.id} className="rounded-lg border border-line bg-paper-sink p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-ink-mute">
            <span className="font-medium text-ink">{c.author.login ?? 'desconhecido'}</span>
            <span>{formatDateTime(c.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function IssueDetailBody({ data }: { data: IssueDetailResult }): ReactElement {
  const { issue, comments } = data;
  const requester = parseRequester(issue.body ?? '');
  const body = bodyWithoutRequester(issue.body ?? '').trim();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
        <span className="rounded-full bg-paper-sink px-2 py-0.5 font-medium">{issue.state}</span>
        {issue.labels.map((l) => (
          <span key={l} className="rounded-full bg-paper-sink px-2 py-0.5">{l}</span>
        ))}
        <span>aberta em {formatDateTime(issue.createdAt)}</span>
      </div>
      {requester !== null && (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper-sink px-3 py-2 text-sm text-ink">
          <Mail className="w-4 h-4 shrink-0 text-ink-mute" />
          <span className="font-medium">Solicitante:</span>
          <a href={`mailto:${requester}`} className="text-[#b07d1a] hover:underline">{requester}</a>
        </div>
      )}
      <p className="whitespace-pre-wrap break-words text-sm text-ink">
        {body.length > 0 ? body : <span className="text-ink-mute">(sem descrição)</span>}
      </p>
      <CommentList comments={comments} />
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-ink-mute hover:text-ink"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Abrir no GitHub
      </a>
    </div>
  );
}

function IssueDetailModal({ number, onClose }: { number: number; onClose: () => void }): ReactElement {
  const getToken = useGetToken();
  const aliveRef = useRef(true);
  const [data, setData] = useState<IssueDetailResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    void (async () => {
      try {
        const token = await getToken();
        const result = await getIssue(number, token);
        if (aliveRef.current) setData(result);
      } catch (err) {
        if (aliveRef.current) setError(err instanceof Error ? err.message : 'Erro desconhecido');
      }
    })();
    return () => { aliveRef.current = false; };
  }, [number, getToken]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-line bg-surface shadow-xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <h3 className="text-sm font-semibold text-ink">
            <span className="font-mono text-ink-mute">#{number}</span>{' '}
            {data?.issue.title ?? ''}
          </h3>
          <button onClick={onClose} className="shrink-0 text-ink-mute hover:text-ink" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {error !== null ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : data === null ? (
            <p className="py-8 text-center text-sm text-ink-mute">Carregando...</p>
          ) : (
            <IssueDetailBody data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function OpenIssuesList(): ReactElement {
  const getToken = useGetToken();
  const [issues, setIssues] = useState<IssueListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [closingNumber, setClosingNumber] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

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
                  <button
                    onClick={() => { setSelected(it.number); }}
                    className="text-left text-sm font-medium text-ink hover:text-[#b07d1a]"
                  >
                    {it.title}
                  </button>
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

      {selected !== null && (
        <IssueDetailModal number={selected} onClose={() => { setSelected(null); }} />
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
