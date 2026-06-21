import { useState, type ReactElement, type FormEvent } from 'react';
import { Check, ExternalLink, Bug } from 'lucide-react';
import { useGetToken } from '../auth';
import {
  ISSUE_KINDS,
  githubIssueInputSchema,
  type GithubIssueInput,
} from '@shared/domain/github-issue';
import { createIssue, type CreateIssueResult } from '../shared/lib/issue-service';
import { AdminGate } from './admin-gate';

const BLANK: GithubIssueInput = { title: '', body: '', kind: 'bug' };

function IssueForm(): ReactElement {
  const getToken = useGetToken();
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
      const issue = await createIssue(result.data, token);
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
          <a
            href={created.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            Abrir <ExternalLink className="w-3.5 h-3.5" />
          </a>
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

export function AdminIssuesPage(): ReactElement {
  return <AdminGate><IssueForm /></AdminGate>;
}
