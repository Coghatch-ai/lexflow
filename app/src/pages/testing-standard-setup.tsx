// Filter step of the Simulado Padrão. Pure move out of TestingPage.tsx (slice
// S2b) — no behaviour change; it left so the file and the run function fit the
// lint budgets before the persistence wiring landed.

import { type ReactElement } from 'react';
import { BookOpen } from 'lucide-react';
import type { Lov } from './testing-standard-types';

interface StandardSetupProps {
  discipline: string;
  examBoard: string;
  difficulty: string;
  loading: boolean;
  disciplineLov: Lov;
  examBoardLov: Lov;
  difficultyLov: Lov;
  /** pt-BR warning about a resumed run (dropped questions), or null. */
  notice: string | null;
  onDisciplineChange: (val: string) => void;
  onExamBoardChange: (val: string) => void;
  onDifficultyChange: (val: string) => void;
  onBack: () => void;
  onStart: () => void;
}

export default function StandardSetup({
  discipline, examBoard, difficulty, loading,
  disciplineLov, examBoardLov, difficultyLov, notice,
  onDisciplineChange, onExamBoardChange, onDifficultyChange, onBack, onStart,
}: StandardSetupProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
          Voltar aos modos
        </button>
      </div>

      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Simulado Padrão</h3>
        <p className="text-white/80">Configure os filtros e comece a resolver questões reais de provas anteriores.</p>
      </div>

      {notice !== null && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {notice}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Disciplina</label>
          <select value={discipline} onChange={(e) => { onDisciplineChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {disciplineLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Banca</label>
          <select value={examBoard} onChange={(e) => { onExamBoardChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {examBoardLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dificuldade</label>
          <select value={difficulty} onChange={(e) => { onDifficultyChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {difficultyLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <BookOpen className="w-5 h-5" />
        {loading ? 'Carregando...' : 'Começar Simulado'}
      </button>
    </div>
  );
}
