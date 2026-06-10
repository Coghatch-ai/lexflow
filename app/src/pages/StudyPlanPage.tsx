import { useState, type ReactElement } from 'react';
import { ClipboardList, Plus, Trash2, TrendingUp, SlidersHorizontal, CheckSquare, Square } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc, type TrpcOutput } from '../shared/lib/trpc';
import { type DeadlineDays } from '@shared/domain/study-plan';

type PlanData = TrpcOutput['studyPlans']['list'][number];

interface PlanCardProps {
  plan: PlanData;
  disciplineLov: ReturnType<typeof useLov>;
  examBoardLov: ReturnType<typeof useLov>;
  phaseLov: ReturnType<typeof useLov>;
  onDelete: (id: string) => void;
}

function PlanCard({ plan, disciplineLov, examBoardLov, phaseLov, onDelete }: PlanCardProps): ReactElement {
  const disciplines = plan.config.disciplines;
  const disciplineLabel =
    disciplines.length > 0
      ? disciplines.map((d) => disciplineLov.labelOf(d)).join(', ')
      : 'Todas';
  const examBoardLabel = plan.config.examBoard !== null
    ? examBoardLov.labelOf(plan.config.examBoard)
    : 'Todas';
  const phaseLabel = plan.config.phase !== null ? phaseLov.labelOf(plan.config.phase) : 'Todas';
  const yearLabel = plan.config.year !== null ? String(plan.config.year) : 'Todos';
  const isComplete = plan.answeredToday >= plan.questionsPerDay;
  const formattedTarget = new Date(plan.targetDate).toLocaleDateString('pt-BR');

  return (
    <div className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="bg-[#16161a]/10 p-3 rounded-lg shrink-0">
            {plan.mode === 'performance'
              ? <TrendingUp className="w-5 h-5 text-[#16161a]" />
              : <SlidersHorizontal className="w-5 h-5 text-[#16161a]" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-[#16161a]">
              {plan.mode === 'performance' ? 'Plano de Desempenho' : 'Plano Personalizado'}
            </h3>
            <p className="text-sm text-gray-600 truncate">{disciplineLabel}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Banca: {examBoardLabel} · Fase: {phaseLabel} · Ano: {yearLabel}
            </p>
          </div>
        </div>
        <button
          onClick={() => { onDelete(plan.id); }}
          className="p-2 hover:bg-red-100 rounded-lg transition text-red-600 shrink-0"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 text-sm text-gray-600">
        <span>
          <span className="font-semibold text-[#16161a]">{plan.questionsPerDay}</span> questões/dia
        </span>
        <span>
          <span className="font-semibold text-[#16161a]">{plan.daysRemaining}</span> dias restantes
        </span>
        <span>Prazo: {formattedTarget}</span>
      </div>

      <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
        <ClipboardList className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm text-gray-600">Hoje:</span>
        <span className={`text-sm font-semibold ${isComplete ? 'text-green-600' : 'text-[#16161a]'}`}>
          {plan.answeredToday} / {plan.questionsPerDay} questões
        </span>
        {isComplete && (
          <span className="ml-auto text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
            Meta do dia atingida!
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Progresso geral</span>
          <span className="font-semibold text-[#16161a]">{plan.progressPct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              plan.progressPct >= 100 ? 'bg-green-500' : 'bg-[#16161a]'
            }`}
            style={{ width: `${Math.min(100, plan.progressPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface CustomModeFormProps {
  disciplineLov: ReturnType<typeof useLov>;
  examBoardLov: ReturnType<typeof useLov>;
  phaseLov: ReturnType<typeof useLov>;
  yearsData: number[] | undefined;
  selectedDisciplines: string[];
  onToggleDiscipline: (code: string) => void;
  examBoard: string;
  onExamBoardChange: (v: string) => void;
  phase: string;
  onPhaseChange: (v: string) => void;
  year: string;
  onYearChange: (v: string) => void;
  deadlineDays: DeadlineDays;
  onDeadlineChange: (v: DeadlineDays) => void;
  deadlineLov: ReturnType<typeof useLov>;
  isPending: boolean;
  onCreate: () => void;
  onBack: () => void;
}

function CustomModeForm({
  disciplineLov, examBoardLov, phaseLov, yearsData,
  selectedDisciplines, onToggleDiscipline,
  examBoard, onExamBoardChange,
  phase, onPhaseChange,
  year, onYearChange,
  deadlineDays, onDeadlineChange, deadlineLov,
  isPending, onCreate, onBack,
}: CustomModeFormProps): ReactElement {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-[#16161a] mb-1">Plano Personalizado</h3>
        <p className="text-sm text-gray-500">Filtre as questões do seu plano</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Disciplinas <span className="text-gray-400 font-normal">(opcional — vazio = todas)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
          {disciplineLov.options.map((o) => {
            const checked = selectedDisciplines.includes(o.code);
            return (
              <button
                key={o.code}
                type="button"
                onClick={() => { onToggleDiscipline(o.code); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                  checked ? 'bg-[#16161a] text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {checked ? <CheckSquare className="w-4 h-4 shrink-0" /> : <Square className="w-4 h-4 shrink-0" />}
                {o.value}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Banca</label>
          <select
            value={examBoard}
            onChange={(e) => { onExamBoardChange(e.target.value); }}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a] text-sm"
          >
            <option value="">Todas</option>
            {examBoardLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Fase</label>
          <select
            value={phase}
            onChange={(e) => { onPhaseChange(e.target.value); }}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a] text-sm"
          >
            <option value="">Todas</option>
            {phaseLov.options.map((o) => (
              <option key={o.code} value={o.code}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
          <select
            value={year}
            onChange={(e) => { onYearChange(e.target.value); }}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a] text-sm"
          >
            <option value="">Todos</option>
            {(yearsData ?? []).map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <DeadlinePicker value={deadlineDays} onChange={onDeadlineChange} lov={deadlineLov} />

      <div className="flex gap-3">
        <button
          onClick={onCreate}
          disabled={isPending}
          className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
        >
          {isPending ? 'Criando...' : 'Criar Plano'}
        </button>
        <button
          onClick={onBack}
          className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}

export default function StudyPlanPage(): ReactElement {
  const utils = trpc.useUtils();
  const plansQuery = trpc.studyPlans.list.useQuery();
  const yearsQuery = trpc.studyPlans.availableYears.useQuery();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const phaseLov = useLov('PHASE');
  const deadlineLov = useLov('PLAN_DEADLINE');

  const [showForm, setShowForm] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'performance' | 'custom' | null>(null);
  const [deadlineDays, setDeadlineDays] = useState<DeadlineDays>(30);
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [examBoard, setExamBoard] = useState<string>('');
  const [phase, setPhase] = useState<string>('');
  const [year, setYear] = useState<string>('');

  const recommendationQuery = trpc.studyPlans.generateRecommendation.useQuery(undefined, {
    enabled: selectedMode === 'performance' && showForm,
  });

  const invalidate = () => {
    void utils.studyPlans.list.invalidate();
  };

  const createPlan = trpc.studyPlans.create.useMutation({ onSuccess: invalidate });
  const deletePlan = trpc.studyPlans.delete.useMutation({ onSuccess: invalidate });

  const resetForm = () => {
    setShowForm(false);
    setSelectedMode(null);
    setDeadlineDays(30);
    setSelectedDisciplines([]);
    setExamBoard('');
    setPhase('');
    setYear('');
  };

  const handleCreate = () => {
    if (selectedMode === 'performance') {
      createPlan.mutate({
        mode: 'performance',
        deadlineDays,
        config: { disciplines: [], examBoard: null, phase: null, year: null },
      });
      resetForm();
    } else if (selectedMode === 'custom') {
      createPlan.mutate({
        mode: 'custom',
        deadlineDays,
        config: {
          disciplines: selectedDisciplines,
          examBoard: examBoard !== '' ? examBoard : null,
          phase: phase !== '' ? phase : null,
          year: year !== '' ? Number(year) : null,
        },
      });
      resetForm();
    }
  };

  const toggleDiscipline = (code: string) => {
    setSelectedDisciplines((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    );
  };

  const plans = plansQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">Planos de Estudo</h2>
        <p className="text-white/80">
          Crie um plano com prazo definido e acompanhe seu ritmo diário de estudos
        </p>
      </div>

      {!showForm && (
        <button
          onClick={() => { setShowForm(true); }}
          className="w-full bg-white border-2 border-dashed border-[#16161a] rounded-xl p-6 hover:bg-gray-50 transition flex items-center justify-center gap-2 text-[#16161a] font-semibold"
        >
          <Plus className="w-5 h-5" />
          Criar Novo Plano
        </button>
      )}

      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow border-2 border-[#16161a]">
          {selectedMode === null && (
            <div>
              <h3 className="text-lg font-bold text-[#16161a] mb-2">Tipo de Plano</h3>
              <p className="text-sm text-gray-500 mb-5">Escolha como o plano será gerado</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => { setSelectedMode('performance'); }}
                  className="flex flex-col items-start gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-[#16161a] hover:bg-gray-50 transition text-left"
                >
                  <div className="bg-[#16161a]/10 p-2.5 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-[#16161a]" />
                  </div>
                  <div>
                    <p className="font-bold text-[#16161a]">Por Desempenho</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      O sistema seleciona as 3 disciplinas com pior desempenho e monta o plano automaticamente
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => { setSelectedMode('custom'); }}
                  className="flex flex-col items-start gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-[#16161a] hover:bg-gray-50 transition text-left"
                >
                  <div className="bg-[#16161a]/10 p-2.5 rounded-lg">
                    <SlidersHorizontal className="w-5 h-5 text-[#16161a]" />
                  </div>
                  <div>
                    <p className="font-bold text-[#16161a]">Personalizado</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Escolha disciplinas, banca, fase e ano para montar seu próprio plano
                    </p>
                  </div>
                </button>
              </div>
              <button
                onClick={resetForm}
                className="mt-4 w-full bg-gray-100 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
            </div>
          )}

          {selectedMode === 'performance' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-[#16161a] mb-1">Plano por Desempenho</h3>
                <p className="text-sm text-gray-500">Disciplinas com menor acurácia serão priorizadas</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-3">Disciplinas identificadas:</p>
                {recommendationQuery.isLoading && (
                  <p className="text-sm text-gray-500 italic">Analisando seu desempenho...</p>
                )}
                {recommendationQuery.isError && (
                  <p className="text-sm text-red-500">
                    Erro ao carregar recomendação. Verifique se você já respondeu questões.
                  </p>
                )}
                {recommendationQuery.data?.disciplines.length === 0 && (
                  <p className="text-sm text-amber-600">
                    Responda pelo menos 5 questões em cada disciplina para gerar uma recomendação.
                  </p>
                )}
                {recommendationQuery.data && recommendationQuery.data.disciplines.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {recommendationQuery.data.disciplines.map((d) => (
                      <span
                        key={d}
                        className="px-3 py-1 bg-[#16161a] text-white text-sm rounded-full"
                      >
                        {disciplineLov.labelOf(d)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <DeadlinePicker value={deadlineDays} onChange={setDeadlineDays} lov={deadlineLov} />
              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={
                    createPlan.isPending ||
                    !recommendationQuery.data ||
                    recommendationQuery.data.disciplines.length === 0
                  }
                  className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition disabled:opacity-50"
                >
                  {createPlan.isPending ? 'Criando...' : 'Criar Plano'}
                </button>
                <button
                  onClick={() => { setSelectedMode(null); }}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
                >
                  Voltar
                </button>
              </div>
            </div>
          )}

          {selectedMode === 'custom' && (
            <CustomModeForm
              disciplineLov={disciplineLov}
              examBoardLov={examBoardLov}
              phaseLov={phaseLov}
              yearsData={yearsQuery.data}
              selectedDisciplines={selectedDisciplines}
              onToggleDiscipline={toggleDiscipline}
              examBoard={examBoard}
              onExamBoardChange={setExamBoard}
              phase={phase}
              onPhaseChange={setPhase}
              year={year}
              onYearChange={setYear}
              deadlineDays={deadlineDays}
              onDeadlineChange={setDeadlineDays}
              deadlineLov={deadlineLov}
              isPending={createPlan.isPending}
              onCreate={handleCreate}
              onBack={() => { setSelectedMode(null); }}
            />
          )}
        </div>
      )}

      <div className="grid gap-4">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            disciplineLov={disciplineLov}
            examBoardLov={examBoardLov}
            phaseLov={phaseLov}
            onDelete={(id) => { deletePlan.mutate({ id }); }}
          />
        ))}
      </div>

      {plans.length === 0 && !showForm && (
        <div className="text-center py-12">
          <ClipboardList className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg mb-2">Nenhum plano de estudo criado ainda</p>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Crie um plano com prazo definido para manter um ritmo consistente de estudos
          </p>
        </div>
      )}
    </div>
  );
}

function DeadlinePicker({
  value,
  onChange,
  lov,
}: {
  value: DeadlineDays;
  onChange: (v: DeadlineDays) => void;
  lov: { options: Array<{ code: string; value: string }> };
}): ReactElement {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Prazo</label>
      <select
        value={value}
        onChange={(e) => { onChange(Number(e.target.value) as DeadlineDays); }}
        className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
      >
        {lov.options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.value}
          </option>
        ))}
      </select>
    </div>
  );
}
