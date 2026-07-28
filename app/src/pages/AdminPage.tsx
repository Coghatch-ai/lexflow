import { useState, type ReactElement } from 'react';
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import type { AdminQuestionInput } from '@shared/domain/admin-question';
import type { AiExplanation } from '@shared/domain/ai-eval';
import { AdminGate } from './admin-gate';
import { QuestionForm } from './admin-question-form';
import { CsvImport } from './admin-csv-import';

export { AdminAlgorithmPage } from './admin-algorithm-page';
export { AdminCalendarPage } from './admin-calendar-page';

type QuestionsTab = 'list' | 'form' | 'import';

type AdminEditInput = AdminQuestionInput & { aiExplanation?: AiExplanation | null };

function QuestionsList({
  onEdit,
  onCreate,
}: {
  onEdit: (q: AdminEditInput) => void;
  onCreate: () => void;
}): ReactElement {
  const utils = trpc.useUtils();
  const [filterDiscipline, setFilterDiscipline] = useState('');
  const [filterBoard, setFilterBoard] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterAi, setFilterAi] = useState<'all' | 'yes' | 'no'>('all');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const disciplineLov = useLov('DISCIPLINE');
  const boardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');

  const query = trpc.admin.questions.list.useQuery({
    discipline: filterDiscipline !== '' ? filterDiscipline : undefined,
    examBoard: filterBoard !== '' ? filterBoard : undefined,
    difficulty: filterDifficulty !== '' ? (filterDifficulty as 'easy' | 'medium' | 'hard') : undefined,
    hasAiExplanation: filterAi,
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
    setFilterAi('all');
    setOffset(0);
  }

  const diffBadge: Partial<Record<string, string>> = {
    easy: 'text-emerald-700 bg-emerald-50',
    medium: 'text-amber-700 bg-amber-50',
    hard: 'text-red-700 bg-red-50',
  };

  return (
    <div className="space-y-4">
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
        <div>
          <label className="block text-xs text-ink-mute mb-1">Explicação IA</label>
          <select
            value={filterAi}
            onChange={(e) => { setFilterAi(e.target.value as 'all' | 'yes' | 'no'); setOffset(0); }}
            className="text-sm border border-line rounded-md px-3 py-1.5 bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-[#d9ab53]"
          >
            <option value="all">Todas</option>
            <option value="yes">Com explicação IA</option>
            <option value="no">Sem explicação IA</option>
          </select>
        </div>
        {(filterDiscipline.length > 0 || filterBoard.length > 0 || filterDifficulty.length > 0 || filterAi !== 'all') && (
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

      {(query.data?.rows.length ?? 1) === 0 && !query.isLoading ? (
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
                <th className="px-3 py-2.5 font-medium w-12">IA</th>
                <th className="px-3 py-2.5 font-medium w-20">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(query.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-paper-sink transition-colors">
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-mute whitespace-nowrap">{row.id}</td>
                  <td className="px-3 py-2.5 text-ink">
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
                    {row.aiExplanation !== null
                      ? <span className="px-1.5 py-0.5 rounded text-xs font-medium text-emerald-700 bg-emerald-50">IA ✓</span>
                      : <span className="text-xs text-ink-mute">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          onEdit({
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
                            aiExplanation: row.aiExplanation,
                          });
                        }}
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-mute">
          <span>Página {currentPage} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => { setOffset(Math.max(0, offset - LIMIT)); }}
              className="p-1.5 rounded border border-line disabled:opacity-40 hover:bg-paper-sink transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={offset + LIMIT >= (query.data?.total ?? 0)}
              onClick={() => { setOffset(offset + LIMIT); }}
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

function QuestionsPanel(): ReactElement {
  const [activeTab, setActiveTab] = useState<QuestionsTab>('list');
  const [editingQuestion, setEditingQuestion] = useState<AdminEditInput | null>(null);

  function openEdit(q: AdminEditInput) {
    setEditingQuestion(q);
    setActiveTab('form');
  }

  function openCreate() {
    setEditingQuestion(null);
    setActiveTab('form');
  }

  const tabs: Array<{ id: QuestionsTab; label: string }> = [
    { id: 'list', label: 'Administrar Questões' },
    { id: 'form', label: editingQuestion !== null ? 'Editar' : 'Adicionar' },
    { id: 'import', label: 'Importar CSV' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">Gerencie o catálogo de questões OAB — adicione, edite ou importe via CSV.</p>
        {activeTab !== 'import' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Questão
          </button>
        )}
      </div>

      <div className="border-b border-line">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); }}
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

      {activeTab === 'list' && <QuestionsList onEdit={openEdit} onCreate={openCreate} />}
      {activeTab === 'form' && (
        <QuestionForm
          initial={editingQuestion}
          onSuccess={() => { setEditingQuestion(null); setActiveTab('list'); }}
          onCancel={() => { setEditingQuestion(null); setActiveTab('list'); }}
        />
      )}
      {activeTab === 'import' && <CsvImport onSuccess={() => { setActiveTab('list'); }} />}
    </div>
  );
}

export function AdminQuestionsPage(): ReactElement {
  // Full-bleed handled by Layout: `/admin/questions` is in Layout's fullBleedPaths,
  // so its content wrapper drops `max-w-[78rem] mx-auto` and this page fills the
  // whole main content area (right of the sidebar). No viewport math here.
  return <AdminGate><QuestionsPanel /></AdminGate>;
}
