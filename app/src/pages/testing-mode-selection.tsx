// Study-mode picker for the Simulado screen. Extracted from TestingPage.tsx
// (pure move, no behaviour change) to keep that file under the max-lines budget.

import { type ReactElement } from 'react';
import { BookOpen } from 'lucide-react';

export type Mode = 'standard' | 'adaptive' | 'spaced' | 'real';

interface ModeSelectionProps {
  onSelect: (mode: Mode) => void;
}

export function ModeSelection({ onSelect }: ModeSelectionProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Escolha o Modo de Estudo</h3>
        <p className="text-white/80">Selecione o tipo de simulado que melhor atende suas necessidades</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <button
          onClick={() => { onSelect('standard'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><BookOpen className="w-6 h-6 text-white" /></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Padrão</h4>
          <p className="text-sm text-gray-600">10 questões com filtros por disciplina, banca e dificuldade. Feedback imediato.</p>
        </button>

        <button
          onClick={() => { onSelect('adaptive'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#16161a] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">A</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Adaptativo</h4>
          <p className="text-sm text-gray-600">Dificuldade ajusta automaticamente conforme seu desempenho em tempo real.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#16161a] bg-[#16161a]/10 px-2 py-1 rounded">INTELIGENTE</span>
        </button>

        <button
          onClick={() => { onSelect('spaced'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">R</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Revisão Espaçada</h4>
          <p className="text-sm text-gray-600">Revise questões nos intervalos ideais para maximizar retenção a longo prazo.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#26262c] bg-[#26262c]/10 px-2 py-1 rounded">RETENÇÃO</span>
        </button>

        <button
          onClick={() => { onSelect('real'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-red-400"
        >
          <div className="bg-red-600 p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">P</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Prova Real</h4>
          <p className="text-sm text-gray-600">80 questões, 5 horas, sem feedback. Simule as condições reais do exame.</p>
          <span className="inline-block mt-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">INTENSO</span>
        </button>
      </div>
    </div>
  );
}
