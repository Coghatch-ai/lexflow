import { useState, type ReactElement, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import { adminQuestionInputSchema, type AdminQuestionInput } from '@shared/domain/admin-question';
import { BLANK_FORM } from './admin-csv-helpers';

interface LegislationFieldsProps {
  legislationTitle?: string | null;
  legislationLink?: string | null;
  onTitleChange: (v: string) => void;
  onLinkChange: (v: string) => void;
}

function LegislationFields({
  legislationTitle,
  legislationLink,
  onTitleChange,
  onLinkChange,
}: LegislationFieldsProps): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Título da Legislação</label>
        <input
          type="text"
          value={legislationTitle ?? ''}
          onChange={(e) => { onTitleChange(e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Ex: Código Civil"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Link da Legislação</label>
        <input
          type="url"
          value={legislationLink ?? ''}
          onChange={(e) => { onLinkChange(e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="https://..."
        />
      </div>
    </div>
  );
}

export function QuestionForm({
  initial,
  onSuccess,
  onCancel,
}: {
  initial: AdminQuestionInput | null;
  onSuccess: () => void;
  onCancel: () => void;
}): ReactElement {
  const utils = trpc.useUtils();
  const isEdit = initial !== null;

  const [form, setForm] = useState<AdminQuestionInput>(initial ?? BLANK_FORM);
  const [errors, setErrors] = useState<string[]>([]);

  const invalidate = () => { void utils.admin.questions.list.invalidate(); };

  const createMutation = trpc.admin.questions.create.useMutation({
    onSuccess: () => { invalidate(); onSuccess(); },
    onError: (e) => { setErrors([e.message]); },
  });
  const updateMutation = trpc.admin.questions.update.useMutation({
    onSuccess: () => { invalidate(); onSuccess(); },
    onError: (e) => { setErrors([e.message]); },
  });

  function setField<K extends keyof AdminQuestionInput>(key: K, value: AdminQuestionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setOption(index: number, value: string) {
    const opts = [...form.options];
    opts[index] = value;
    setField('options', opts);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    const result = adminQuestionInputSchema.safeParse(form);
    if (!result.success) {
      setErrors(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    if (isEdit && form.id !== undefined) {
      updateMutation.mutate({ ...result.data, id: form.id });
    } else {
      createMutation.mutate(result.data);
    }
  }

  const disciplineLov = useLov('DISCIPLINE');
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {errors.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-1">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {isEdit && (
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">ID</label>
          <input
            readOnly
            value={form.id ?? ''}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-paper-sink text-ink-mute font-mono"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Enunciado <span className="text-red-500">*</span></label>
        <textarea
          rows={4}
          value={form.questionText}
          onChange={(e) => { setField('questionText', e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Texto da questão..."
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-2">Alternativas <span className="text-red-500">*</span></label>
        <div className="space-y-2">
          {['A', 'B', 'C', 'D'].map((letter, i) => (
            <div key={letter} className="flex items-center gap-2">
              <span className="w-6 h-6 flex items-center justify-center rounded bg-paper-sink text-xs font-bold text-ink-mute shrink-0">
                {letter}
              </span>
              <input
                type="text"
                value={form.options.at(i) ?? ''}
                onChange={(e) => { setOption(i, e.target.value); }}
                className="flex-1 text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
                placeholder={`Alternativa ${letter}`}
                required
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Resposta Correta <span className="text-red-500">*</span></label>
        <select
          value={form.correctAnswer}
          onChange={(e) => { setField('correctAnswer', e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          required
        >
          <option value="">Selecionar...</option>
          {form.options.map((opt, i) =>
            opt.trim().length > 0 ? (
              <option key={i} value={opt}>{['A', 'B', 'C', 'D'][i]}: {opt}</option>
            ) : null
          )}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">Disciplina <span className="text-red-500">*</span></label>
          <select
            value={form.discipline}
            onChange={(e) => { setField('discipline', e.target.value); }}
            className="w-full text-sm border border-line rounded-lg px-2 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            required
          >
            <option value="">Selecionar...</option>
            {disciplineLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">Dificuldade <span className="text-red-500">*</span></label>
          <select
            value={form.difficulty}
            onChange={(e) => { setField('difficulty', e.target.value as 'easy' | 'medium' | 'hard'); }}
            className="w-full text-sm border border-line rounded-lg px-2 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="easy">Fácil</option>
            <option value="medium">Médio</option>
            <option value="hard">Difícil</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">Banca <span className="text-red-500">*</span></label>
          <select
            value={form.examBoard}
            onChange={(e) => { setField('examBoard', e.target.value); }}
            className="w-full text-sm border border-line rounded-lg px-2 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="FGV">FGV</option>
            <option value="CESPE">CESPE</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">Fase</label>
          <select
            value={form.phase}
            onChange={(e) => { setField('phase', e.target.value as '1st' | '2nd'); }}
            className="w-full text-sm border border-line rounded-lg px-2 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="1st">1ª Fase</option>
            <option value="2nd">2ª Fase</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Tópico <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.topic}
            onChange={(e) => { setField('topic', e.target.value); }}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            placeholder="Ex: Prescrição"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Ano <span className="text-red-500">*</span></label>
          <input
            type="number"
            min={2000}
            max={2030}
            value={form.year}
            onChange={(e) => { const y = parseInt(e.target.value, 10); setField('year', Number.isNaN(y) ? 2024 : y); }}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Base Legal</label>
        <input
          type="text"
          value={form.legalBasis ?? ''}
          onChange={(e) => { setField('legalBasis', e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Ex: CC/2002 Art. 205"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Explicação <span className="text-red-500">*</span></label>
        <textarea
          rows={3}
          value={form.explanation}
          onChange={(e) => { setField('explanation', e.target.value); }}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Por que a resposta correta está certa..."
          required
        />
      </div>

      <LegislationFields
        legislationTitle={form.legislationTitle}
        legislationLink={form.legislationLink}
        onTitleChange={(v) => { setField('legislationTitle', v); }}
        onLinkChange={(v) => { setField('legislationLink', v); }}
      />

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] disabled:opacity-60 transition-colors"
        >
          <Check className="w-4 h-4" />
          {isPending ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Questão'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-sm font-medium text-ink-mute border border-line rounded-lg hover:bg-paper-sink transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
