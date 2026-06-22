import { useState, type ReactElement } from 'react';
import { Target, Plus, Trash2, CreditCard as Edit2 } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { goalProgressPct } from '@shared/domain/scoring';

interface GoalWithProgress {
  id: string;
  discipline: string;
  target_accuracy: number;
  current_accuracy: number;
  progress: number;
}

export default function GoalsPage(): ReactElement {
  const utils = trpc.useUtils();
  const goalsQuery = trpc.goals.list.useQuery();
  const byDiscipline = trpc.stats.byDiscipline.useQuery();
  const disciplineLov = useLov('DISCIPLINE');

  const [showForm, setShowForm] = useState(false);
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [targetAccuracy, setTargetAccuracy] = useState(70);
  const [editingId, setEditingId] = useState<string | null>(null);

  const invalidate = () => {
    void utils.goals.list.invalidate();
  };
  const createGoal = trpc.goals.create.useMutation({ onSuccess: invalidate });
  const updateGoal = trpc.goals.update.useMutation({ onSuccess: invalidate });
  const deleteGoal = trpc.goals.delete.useMutation({ onSuccess: invalidate });

  // Current accuracy per discipline → goal progress.
  const accuracyByDiscipline: Record<string, number> = {};
  for (const d of byDiscipline.data ?? []) accuracyByDiscipline[d.discipline] = d.accuracy;

  const goals: GoalWithProgress[] = (goalsQuery.data ?? []).map((g) => {
    const current = accuracyByDiscipline[g.discipline] ?? 0;
    const progress = goalProgressPct(current, g.targetAccuracy);
    return {
      id: g.id,
      discipline: g.discipline,
      target_accuracy: g.targetAccuracy,
      current_accuracy: current,
      progress,
    };
  });

  const handleAddGoal = () => {
    if (selectedDiscipline === '') return;
    if (editingId !== null) {
      updateGoal.mutate({ id: editingId, targetAccuracy });
      setEditingId(null);
    } else {
      createGoal.mutate({ discipline: selectedDiscipline, targetAccuracy });
    }
    setSelectedDiscipline('');
    setTargetAccuracy(70);
    setShowForm(false);
  };

  const handleDeleteGoal = (id: string) => {
    deleteGoal.mutate({ id });
  };

  const availableDisciplines = disciplineLov.options.filter(
    (o) => !goals.find((g) => g.discipline === o.code)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">Suas Metas de Estudo</h2>
        <p className="text-white/80">
          Estabeleça objetivos para cada disciplina e acompanhe seu progresso
        </p>
      </div>

      {/* Add Goal Button */}
      {!showForm && (
        <button
          onClick={() => { setShowForm(true); }}
          className="w-full bg-white border-2 border-dashed border-[#16161a] rounded-xl p-6 hover:bg-gray-50 transition flex items-center justify-center gap-2 text-[#16161a] font-semibold"
        >
          <Plus className="w-5 h-5" />
          Adicionar Nova Meta
        </button>
      )}

      {/* Add Goal Form */}
      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow border-2 border-[#16161a]">
          <h3 className="text-lg font-bold text-[#16161a] mb-4">
            {editingId !== null ? 'Editar Meta' : 'Nova Meta'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Disciplina
              </label>
              <select
                value={selectedDiscipline}
                onChange={(e) => { setSelectedDiscipline(e.target.value); }}
                disabled={editingId !== null}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
              >
                <option value="">Selecione uma disciplina</option>
                {(editingId !== null ? disciplineLov.options : availableDisciplines).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Acurácia Alvo: {targetAccuracy}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={targetAccuracy}
                onChange={(e) => { setTargetAccuracy(Number(e.target.value)); }}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAddGoal}
                className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-2 rounded-lg font-semibold hover:shadow-lg transition"
              >
                {editingId !== null ? 'Atualizar' : 'Criar Meta'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setSelectedDiscipline('');
                  setTargetAccuracy(70);
                }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goals List */}
      <div className="grid gap-4">
        {goals.map((goal) => (
          <div
            key={goal.id}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="bg-[#16161a]/10 p-3 rounded-lg">
                  <Target className="w-6 h-6 text-[#16161a]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-[#16161a]">
                    {disciplineLov.labelOf(goal.discipline)}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Alvo: {goal.target_accuracy}% | Atual: {goal.current_accuracy}
                    %
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingId(goal.id);
                    setSelectedDiscipline(goal.discipline);
                    setTargetAccuracy(goal.target_accuracy);
                    setShowForm(true);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-700"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => { handleDeleteGoal(goal.id); }}
                  className="p-2 hover:bg-red-100 rounded-lg transition text-red-600"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Progresso</span>
                <span className="font-semibold text-[#16161a]">
                  {goal.progress}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    goal.progress >= 100
                      ? 'bg-green-500'
                      : goal.progress >= 70
                        ? 'bg-[#16161a]'
                        : 'bg-[#26262c]'
                  }`}
                  style={{ width: `${goal.progress}%` }}
                />
              </div>
            </div>

            {/* Status message */}
            {goal.progress >= 100 && (
              <div className="mt-3 p-2 bg-green-50 rounded-lg text-sm text-green-700 font-medium">
                Meta atingida! Parabéns!
              </div>
            )}
          </div>
        ))}
      </div>

      {goals.length === 0 && !showForm && (
        <div className="text-center py-12">
          <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg mb-4">Nenhuma meta definida ainda</p>
          <p className="text-gray-500 text-sm max-w-lg mx-auto mb-6">
            Crie metas para cada disciplina e acompanhe seu progresso rumo à
            aprovação!
          </p>
        </div>
      )}
    </div>
  );
}
