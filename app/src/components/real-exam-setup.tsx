// The Simulado Real's setup card, moved out of RealExamSimulation.tsx as a
// pure extraction (epic #67 slice S2d) plus ONE addition: the notice slot.
//
// The notice is where a prova real that ended while the student was away is
// reported. BR-05.5 — "from the student's point of view the exam simply
// ended" — so there is no result screen to come back to and no offer to
// continue: the setup card, with a line saying the previous exam was processed
// and where to find it.

import type { ReactElement } from 'react';
import { AlertCircle, Flag, Info } from 'lucide-react';
import { QUESTIONS_PER_EXAM } from './real-exam-types';

interface ExamSetupProps {
  loading: boolean;
  /** pt-BR line about the exam that was settled while away, or null. */
  notice: string | null;
  onStart: () => void;
}

export default function ExamSetup({ loading, notice, onStart }: ExamSetupProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#16161a] p-3 rounded-lg">
          <Flag className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#16161a]">Simulado Estilo Prova Real</h3>
          <p className="text-sm text-gray-600">Simule as condições reais do exame</p>
        </div>
      </div>

      {notice !== null && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800">{notice}</p>
        </div>
      )}

      <div className="bg-[#16161a]/5 rounded-lg p-4 mb-6 space-y-2">
        <h4 className="font-semibold text-[#16161a]">Configuração do Simulado:</h4>
        <ul className="space-y-1 text-sm text-gray-700">
          <li>- {QUESTIONS_PER_EXAM} questões (como a prova real)</li>
          <li>- 5 horas de duração</li>
          <li>- Sem feedback durante o simulado</li>
          <li>- Pode sinalizar questões para revisar depois</li>
          <li>- Pode adiar questões para responder depois</li>
          <li>- Navegue livremente entre questões</li>
          <li>- É preciso responder todas as questões para encerrar manualmente</li>
          <li>- Timer regressivo como na prova real</li>
        </ul>
      </div>

      <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">Atenção!</p>
            <p className="text-sm text-red-600">
              Este simulado simula condições reais de prova. Não haverá feedback
              durante o exame. Certifique-se de ter tempo disponível. O prazo de 5 horas
              corre no relógio do servidor: fechar a aba não pausa a prova, e as respostas
              já dadas são processadas quando ele termina.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Flag className="w-5 h-5" />
        {loading ? 'Carregando...' : 'Iniciar Simulado Real'}
      </button>
    </div>
  );
}
