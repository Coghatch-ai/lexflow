import { useState, useRef } from 'react';
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import { adminQuestionInputSchema } from '@shared/domain/admin-question';
import type { AdminQuestionInput } from '@shared/domain/admin-question';

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_HEADER =
  'id,question_text,option_a,option_b,option_c,option_d,correct_answer,legal_basis,explanation,legislation_link,legislation_title,difficulty,discipline,topic,exam_board,year,phase';

function splitCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCSVRow(lines[0]).map((h) => h.trim().replace(/^﻿/, ''));
  return lines.slice(1).map((line) => {
    const values = splitCSVRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
    return obj;
  });
}

function csvRowToInput(row: Record<string, string>): AdminQuestionInput {
  const idRaw = (row['id'] ?? '').trim();
  return {
    id: idRaw.length > 0 ? idRaw : undefined,
    questionText: row['question_text'] ?? '',
    options: [
      row['option_a'] ?? '',
      row['option_b'] ?? '',
      row['option_c'] ?? '',
      row['option_d'] ?? '',
    ],
    correctAnswer: row['correct_answer'] ?? '',
    legalBasis: row['legal_basis'] ?? '',
    explanation: row['explanation'] ?? '',
    legislationLink: row['legislation_link'] ?? '',
    legislationTitle: row['legislation_title'] ?? '',
    difficulty: (row['difficulty'] ?? 'medium') as 'easy' | 'medium' | 'hard',
    discipline: row['discipline'] ?? '',
    topic: row['topic'] ?? '',
    examBoard: row['exam_board'] ?? '',
    year: parseInt(row['year'] ?? '2024', 10) || 2024,
    phase: (row['phase'] ?? '1st') as '1st' | '2nd',
  };
}

function downloadTemplate() {
  const example =
    ',Qual é o prazo prescricional geral do Código Civil?,3 anos,5 anos,10 anos,20 anos,10 anos,CC/2002 Art. 205,O prazo prescricional geral é de 10 anos conforme o Art. 205 do CC.,,Código Civil,medium,CIVIL_LAW,Prescrição,FGV,2023,1st';
  const content = `${CSV_HEADER}\n${example}\n`;
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questoes_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Blank form state
// ---------------------------------------------------------------------------

const BLANK_FORM: AdminQuestionInput = {
  id: '',
  questionText: '',
  options: ['', '', '', ''],
  correctAnswer: '',
  legalBasis: '',
  explanation: '',
  legislationLink: '',
  legislationTitle: '',
  difficulty: 'medium',
  discipline: '',
  topic: '',
  examBoard: 'FGV',
  year: 2024,
  phase: '1st',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const me = trpc.users.me.useQuery();

  if (me.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-mute">
        Carregando...
      </div>
    );
  }

  if (me.data?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <Shield className="w-10 h-10 text-ink-mute" strokeWidth={1.5} />
        <p className="text-lg font-semibold text-ink">Acesso restrito</p>
        <p className="text-sm text-ink-mute">Esta página requer permissão de administrador.</p>
      </div>
    );
  }

  return <AdminPanel />;
}

// ---------------------------------------------------------------------------
// AdminPanel — rendered only for admin users
// ---------------------------------------------------------------------------

type Tab = 'list' | 'form' | 'import';

function AdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [editingQuestion, setEditingQuestion] = useState<AdminQuestionInput | null>(null);

  function openEdit(q: AdminQuestionInput) {
    setEditingQuestion(q);
    setActiveTab('form');
  }

  function openCreate() {
    setEditingQuestion(null);
    setActiveTab('form');
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'list', label: 'Questões' },
    { id: 'form', label: editingQuestion ? 'Editar' : 'Adicionar' },
    { id: 'import', label: 'Importar CSV' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#d9ab53]" strokeWidth={1.75} />
          <div>
            <h1 className="font-display text-xl font-bold text-ink">Admin</h1>
            <p className="text-sm text-ink-mute">Gerenciar catálogo de questões OAB</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova Questão
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-line">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#d9ab53] text-ink'
                  : 'border-transparent text-ink-mute hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'list' && (
        <QuestionsList onEdit={openEdit} onCreate={openCreate} />
      )}
      {activeTab === 'form' && (
        <QuestionForm
          initial={editingQuestion}
          onSuccess={() => {
            setEditingQuestion(null);
            setActiveTab('list');
          }}
          onCancel={() => {
            setEditingQuestion(null);
            setActiveTab('list');
          }}
        />
      )}
      {activeTab === 'import' && (
        <CsvImport onSuccess={() => setActiveTab('list')} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions list
// ---------------------------------------------------------------------------

function QuestionsList({
  onEdit,
  onCreate,
}: {
  onEdit: (q: AdminQuestionInput) => void;
  onCreate: () => void;
}) {
  const utils = trpc.useUtils();
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterBoard, setFilterBoard] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const disciplineLov = useLov('DISCIPLINE');
  const boardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');

  const query = trpc.admin.questions.list.useQuery({
    discipline: filterDiscipline || undefined,
    examBoard: filterBoard || undefined,
    difficulty: (filterDifficulty || undefined) as 'easy' | 'medium' | 'hard' | undefined,
    offset,
    limit: LIMIT,
  });

  const deleteMutation = trpc.admin.questions.delete.useMutation({
    onSuccess: () => { void utils.admin.questions.list.invalidate(); },
  });

  const totalPages = Math.ceil((query.data?.total ?? 0) / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  function resetFilters() {
    setFilterDiscipline('');
    setFilterBoard('');
    setFilterDifficulty('');
    setOffset(0);
  }

  const diffBadge: Record<string, string> = {
    easy: 'text-emerald-700 bg-emerald-50',
    medium: 'text-amber-700 bg-amber-50',
    hard: 'text-red-700 bg-red-50',
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-ink-mute mb-1">Disciplina</label>
          <select
            value={filterDiscipline}
            onChange={(e) => { setFilterDiscipline(e.target.value); setOffset(0); }}
            className="text-sm border border-line rounded-md px-3 py-1.5 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="">Todas</option>
            {disciplineLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-mute mb-1">Banca</label>
          <select
            value={filterBoard}
            onChange={(e) => { setFilterBoard(e.target.value); setOffset(0); }}
            className="text-sm border border-line rounded-md px-3 py-1.5 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="">Todas</option>
            {boardLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-mute mb-1">Dificuldade</label>
          <select
            value={filterDifficulty}
            onChange={(e) => { setFilterDifficulty(e.target.value); setOffset(0); }}
            className="text-sm border border-line rounded-md px-3 py-1.5 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="">Todas</option>
            {difficultyLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        {(filterDiscipline || filterBoard || filterDifficulty) && (
          <button
            onClick={resetFilters}
            className="text-sm text-ink-mute hover:text-ink flex items-center gap-1 pb-0.5"
          >
            <X className="w-3.5 h-3.5" /> Limpar
          </button>
        )}
        <div className="ml-auto text-sm text-ink-mute self-end pb-1">
          {query.isLoading ? 'Carregando...' : `${query.data?.total ?? 0} questão(ões)`}
        </div>
      </div>

      {/* Table */}
      {query.data?.rows.length === 0 && !query.isLoading ? (
        <div className="text-center py-16 text-ink-mute">
          <p>Nenhuma questão encontrada.</p>
          <button onClick={onCreate} className="mt-3 text-[#d9ab53] text-sm hover:underline">
            Adicionar a primeira questão
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-paper-sink text-ink-mute text-left">
              <tr>
                <th className="px-3 py-2.5 font-medium">ID</th>
                <th className="px-3 py-2.5 font-medium">Enunciado</th>
                <th className="px-3 py-2.5 font-medium">Disciplina</th>
                <th className="px-3 py-2.5 font-medium">Banca</th>
                <th className="px-3 py-2.5 font-medium">Ano</th>
                <th className="px-3 py-2.5 font-medium">Dificuldade</th>
                <th className="px-3 py-2.5 font-medium w-20">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(query.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-paper-sink transition-colors">
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-mute whitespace-nowrap">{row.id}</td>
                  <td className="px-3 py-2.5 text-ink max-w-xs">
                    <p className="line-clamp-2">{row.questionText}</p>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft whitespace-nowrap">
                    {disciplineLov.labelOf(row.discipline)}
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">{row.examBoard}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{row.year}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${diffBadge[row.difficulty] ?? ''}`}>
                      {difficultyLov.labelOf(row.difficulty)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onEdit({
                          id: row.id,
                          questionText: row.questionText,
                          options: row.options,
                          correctAnswer: row.correctAnswer,
                          legalBasis: row.legalBasis,
                          explanation: row.explanation,
                          legislationLink: row.legislationLink,
                          legislationTitle: row.legislationTitle,
                          difficulty: row.difficulty as 'easy' | 'medium' | 'hard',
                          discipline: row.discipline,
                          topic: row.topic,
                          examBoard: row.examBoard,
                          year: row.year,
                          phase: row.phase as '1st' | '2nd',
                        })}
                        className="p-1.5 rounded hover:bg-[#d9ab53]/10 text-ink-mute hover:text-[#d9ab53] transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Excluir questão ${row.id}?`)) {
                            deleteMutation.mutate({ id: row.id });
                          }
                        }}
                        className="p-1.5 rounded hover:bg-red-50 text-ink-mute hover:text-red-600 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-mute">
          <span>Página {currentPage} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="p-1.5 rounded border border-line disabled:opacity-40 hover:bg-paper-sink transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={offset + LIMIT >= (query.data?.total ?? 0)}
              onClick={() => setOffset(offset + LIMIT)}
              className="p-1.5 rounded border border-line disabled:opacity-40 hover:bg-paper-sink transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question form (create + edit)
// ---------------------------------------------------------------------------

function QuestionForm({
  initial,
  onSuccess,
  onCancel,
}: {
  initial: AdminQuestionInput | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const utils = trpc.useUtils();
  const isEdit = initial !== null;

  const [form, setForm] = useState<AdminQuestionInput>(initial ?? BLANK_FORM);
  const [errors, setErrors] = useState<string[]>([]);

  const invalidate = () => { void utils.admin.questions.list.invalidate(); };

  const createMutation = trpc.admin.questions.create.useMutation({
    onSuccess: () => { invalidate(); onSuccess(); },
    onError: (e) => setErrors([e.message]),
  });
  const updateMutation = trpc.admin.questions.update.useMutation({
    onSuccess: () => { invalidate(); onSuccess(); },
    onError: (e) => setErrors([e.message]),
  });

  function setField<K extends keyof AdminQuestionInput>(key: K, value: AdminQuestionInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setOption(index: number, value: string) {
    const opts = [...(form.options ?? ['', '', '', ''])];
    opts[index] = value;
    setField('options', opts);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const result = adminQuestionInputSchema.safeParse(form);
    if (!result.success) {
      setErrors(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    if (isEdit && form.id) {
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

      {/* ID */}
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

      {/* Question text */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Enunciado <span className="text-red-500">*</span></label>
        <textarea
          rows={4}
          value={form.questionText}
          onChange={(e) => setField('questionText', e.target.value)}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Texto da questão..."
          required
        />
      </div>

      {/* Options */}
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
                value={form.options[i] ?? ''}
                onChange={(e) => setOption(i, e.target.value)}
                className="flex-1 text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
                placeholder={`Alternativa ${letter}`}
                required
              />
            </div>
          ))}
        </div>
      </div>

      {/* Correct answer */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Resposta Correta <span className="text-red-500">*</span></label>
        <select
          value={form.correctAnswer}
          onChange={(e) => setField('correctAnswer', e.target.value)}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          required
        >
          <option value="">Selecionar...</option>
          {(form.options ?? []).map((opt, i) =>
            opt.trim().length > 0 ? (
              <option key={i} value={opt}>{['A', 'B', 'C', 'D'][i]}: {opt}</option>
            ) : null
          )}
        </select>
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-mute mb-1">Disciplina <span className="text-red-500">*</span></label>
          <select
            value={form.discipline}
            onChange={(e) => setField('discipline', e.target.value)}
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
            onChange={(e) => setField('difficulty', e.target.value as 'easy' | 'medium' | 'hard')}
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
            onChange={(e) => setField('examBoard', e.target.value)}
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
            onChange={(e) => setField('phase', e.target.value as '1st' | '2nd')}
            className="w-full text-sm border border-line rounded-lg px-2 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="1st">1ª Fase</option>
            <option value="2nd">2ª Fase</option>
          </select>
        </div>
      </div>

      {/* Topic + Year */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Tópico <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.topic}
            onChange={(e) => setField('topic', e.target.value)}
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
            onChange={(e) => setField('year', parseInt(e.target.value, 10) || 2024)}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            required
          />
        </div>
      </div>

      {/* Legal basis + Explanation */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Base Legal</label>
        <input
          type="text"
          value={form.legalBasis}
          onChange={(e) => setField('legalBasis', e.target.value)}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Ex: CC/2002 Art. 205"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Explicação <span className="text-red-500">*</span></label>
        <textarea
          rows={3}
          value={form.explanation}
          onChange={(e) => setField('explanation', e.target.value)}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          placeholder="Por que a resposta correta está certa..."
          required
        />
      </div>

      {/* Legislation */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Título da Legislação</label>
          <input
            type="text"
            value={form.legislationTitle}
            onChange={(e) => setField('legislationTitle', e.target.value)}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            placeholder="Ex: Código Civil"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Link da Legislação</label>
          <input
            type="url"
            value={form.legislationLink}
            onChange={(e) => setField('legislationLink', e.target.value)}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
            placeholder="https://..."
          />
        </div>
      </div>

      {/* Actions */}
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

// ---------------------------------------------------------------------------
// CSV bulk import
// ---------------------------------------------------------------------------

type ParsedRow = {
  index: number;
  raw: AdminQuestionInput;
  valid: boolean;
  errors: string[];
};

function CsvImport({ onSuccess }: { onSuccess: () => void }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importResult, setImportResult] = useState<{ upserted: number } | null>(null);

  const disciplineLov = useLov('DISCIPLINE');

  const bulkUpsert = trpc.admin.questions.bulkUpsert.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      void utils.admin.questions.list.invalidate();
    },
    onError: (e) => {
      setRows((prev) =>
        prev.map((r, i) => (i === 0 ? { ...r, errors: [e.message] } : r))
      );
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      const rawRows = parseCSVText(text);
      const parsed: ParsedRow[] = rawRows.map((raw, idx) => {
        const input = csvRowToInput(raw);
        const result = adminQuestionInputSchema.safeParse(input);
        return {
          index: idx + 1,
          raw: input,
          valid: result.success,
          errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      });
      setRows(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  }

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  function handleImport() {
    if (validRows.length === 0) return;
    bulkUpsert.mutate(validRows.map((r) => r.raw));
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Instructions */}
      <div className="bg-[#16161a] rounded-xl p-5 text-sm space-y-3">
        <p className="font-semibold text-surface flex items-center gap-2">
          <Upload className="w-4 h-4 text-[#d9ab53]" />
          Importação via CSV
        </p>
        <ol className="list-decimal list-inside space-y-1 text-white/70 pl-1">
          <li>Baixe o template CSV abaixo e preencha com as questões</li>
          <li>Salve como CSV (UTF-8) no Excel: <em>Arquivo → Salvar como → CSV UTF-8</em></li>
          <li>Faça upload do arquivo e revise a pré-visualização</li>
          <li>Clique em Importar — rows com ID existente serão atualizadas</li>
        </ol>
        <div>
          <p className="text-white/50 text-xs mb-2">Colunas esperadas:</p>
          <code className="text-[0.68rem] text-[#d9ab53] break-all">{CSV_HEADER}</code>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-3 py-1.5 border border-[#d9ab53]/40 text-[#d9ab53] text-xs font-medium rounded-lg hover:bg-[#d9ab53]/10 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar template
        </button>
      </div>

      {/* File picker */}
      <div>
        <label className="block text-sm font-medium text-ink mb-2">Arquivo CSV</label>
        <div
          className="flex items-center gap-3 border-2 border-dashed border-line rounded-xl p-6 cursor-pointer hover:border-[#d9ab53]/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-ink-mute shrink-0" />
          <div>
            <p className="text-sm font-medium text-ink">
              {fileName || 'Clique para selecionar ou arraste aqui'}
            </p>
            <p className="text-xs text-ink-mute mt-0.5">CSV, máx. 500 linhas</p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      {/* Preview / summary */}
      {rows.length > 0 && !importResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-700">
              <Check className="w-4 h-4" /> {validRows.length} válida(s)
            </span>
            {invalidRows.length > 0 && (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertCircle className="w-4 h-4" /> {invalidRows.length} inválida(s) (serão ignoradas)
              </span>
            )}
          </div>

          {invalidRows.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-1">
              <p className="font-semibold">Erros encontrados (linhas ignoradas):</p>
              {invalidRows.slice(0, 10).map((r) => (
                <p key={r.index}>Linha {r.index + 1}: {r.errors.join(', ')}</p>
              ))}
              {invalidRows.length > 10 && (
                <p>…e mais {invalidRows.length - 10} linha(s)</p>
              )}
            </div>
          )}

          {/* Preview table */}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-paper-sink text-ink-mute text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Enunciado</th>
                  <th className="px-3 py-2 font-medium">Disciplina</th>
                  <th className="px-3 py-2 font-medium">Banca</th>
                  <th className="px-3 py-2 font-medium">Dificuldade</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, 20).map((r) => (
                  <tr key={r.index} className={r.valid ? '' : 'bg-red-50/50'}>
                    <td className="px-3 py-2 text-ink-mute">{r.index}</td>
                    <td className="px-3 py-2 text-ink max-w-xs">
                      <p className="line-clamp-1">{r.raw.questionText || '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{disciplineLov.labelOf(r.raw.discipline)}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.raw.examBoard}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.raw.difficulty}</td>
                    <td className="px-3 py-2">
                      {r.valid
                        ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                        : <span title={r.errors.join(', ')}><AlertCircle className="w-3.5 h-3.5 text-red-500" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && (
              <p className="px-3 py-2 text-xs text-ink-mute border-t border-line">
                Mostrando 20 de {rows.length} linhas na prévia
              </p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={validRows.length === 0 || bulkUpsert.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] disabled:opacity-60 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {bulkUpsert.isPending
              ? 'Importando...'
              : `Importar ${validRows.length} questão(ões)`}
          </button>
        </div>
      )}

      {/* Success */}
      {importResult && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
          <Check className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold">{importResult.upserted} questão(ões) importada(s) com sucesso!</p>
            <button
              onClick={() => { setRows([]); setFileName(''); setImportResult(null); onSuccess(); }}
              className="mt-1 text-sm underline hover:no-underline"
            >
              Ver questões
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
