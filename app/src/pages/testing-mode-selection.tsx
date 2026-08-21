// Study-mode picker for the Simulado screen. Extracted from TestingPage.tsx
// (pure move, no behaviour change) to keep that file under the max-lines budget.
//
// Since slice S2b (#77) it also offers a SAVED run back: `examDrafts.list`
// feeds the "Continuar (n/N)" of the Simulado Padrão. Starting a new run while
// one is alive ASKS first (BR-05.8) — it never overwrites. The server enforces
// the same rule anyway (a `token: null` save over a live row answers CONFLICT),
// so this dialog is the courteous half of a guarantee that does not depend on it.

import { useState, type ReactElement } from 'react';
import { BookOpen } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { resumableFor } from '../shared/lib/run-persistence';

export type Mode = 'standard' | 'adaptive' | 'spaced' | 'real';

/** `resume` continues the saved run of that mode; `new` starts a fresh one. */
export type StartIntent = 'new' | 'resume';

interface ModeSelectionProps {
  onSelect: (mode: Mode, intent: StartIntent) => void;
}

export function ModeSelection({ onSelect }: ModeSelectionProps): ReactElement {
  const utils = trpc.useUtils();
  const draftsQuery = trpc.examDrafts.list.useQuery();
  const discardMutation = trpc.examDrafts.discard.useMutation();
  const [asking, setAsking] = useState(false);

  // Only the Simulado Padrão is wired in this slice — the Espaçada and the
  // Adaptativo get their cards in #78, the prova real never resumes (BR-05.5).
  const saved = resumableFor(draftsQuery.data, 'standard');
  const progress = saved === null ? '' : `(${String(saved.answered)}/${String(saved.total)})`;

  const discardSaved = async (): Promise<void> => {
    await discardMutation.mutateAsync({ mode: 'standard' });
    // The whole router: `get` caches the row this call just deleted, and the
    // run started right after would read it back as if it were alive.
    await utils.examDrafts.invalidate();
    setAsking(false);
    onSelect('standard', 'new');
  };

  const startStandard = (): void => {
    // A live run is never bulldozed: ask, then continue or discard (BR-05.8).
    if (saved !== null) {
      setAsking(true);
      return;
    }
    onSelect('standard', 'new');
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Escolha o Modo de Estudo</h3>
        <p className="text-white/80">Selecione o tipo de simulado que melhor atende suas necessidades</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow hover:shadow-lg transition border-2 border-transparent hover:border-[#16161a] overflow-hidden">
          <button onClick={startStandard} className="w-full p-6 text-left">
            <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><BookOpen className="w-6 h-6 text-white" /></div>
            <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Padrão</h4>
            <p className="text-sm text-gray-600">10 questões com filtros por disciplina, banca e dificuldade. Feedback imediato.</p>
          </button>
          {saved !== null && (
            <div className="flex gap-2 px-6 pb-6">
              <button
                onClick={() => { onSelect('standard', 'resume'); }}
                className="flex-1 bg-[#16161a] text-white py-2 rounded-lg text-sm font-semibold hover:bg-[#26262c] transition"
              >
                Continuar {progress}
              </button>
              <button
                onClick={() => { void discardMutation.mutateAsync({ mode: 'standard' }).then(() => utils.examDrafts.invalidate()); }}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300 transition"
              >
                Descartar
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => { onSelect('adaptive', 'new'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#16161a] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">A</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Adaptativo</h4>
          <p className="text-sm text-gray-600">Dificuldade ajusta automaticamente conforme seu desempenho em tempo real.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#16161a] bg-[#16161a]/10 px-2 py-1 rounded">INTELIGENTE</span>
        </button>

        <button
          onClick={() => { onSelect('spaced', 'new'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">R</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Revisão Espaçada</h4>
          <p className="text-sm text-gray-600">Revise questões nos intervalos ideais para maximizar retenção a longo prazo.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#26262c] bg-[#26262c]/10 px-2 py-1 rounded">RETENÇÃO</span>
        </button>

        <button
          onClick={() => { onSelect('real', 'new'); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-red-400"
        >
          <div className="bg-red-600 p-3 rounded-lg w-fit mb-4"><span className="text-white text-xl font-bold">P</span></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Prova Real</h4>
          <p className="text-sm text-gray-600">80 questões, 5 horas, sem feedback. Simule as condições reais do exame.</p>
          <span className="inline-block mt-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">INTENSO</span>
        </button>
      </div>

      {asking && saved !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-[#16161a] mb-4">Você tem um Simulado Padrão em andamento.</h3>
            <p className="text-gray-600 mb-4">
              Continue de onde parou {progress} ou descarte o teste salvo para começar um novo. Um
              teste em andamento nunca é sobrescrito.
            </p>
            <button
              onClick={() => { onSelect('standard', 'resume'); }}
              className="w-full mb-3 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition"
            >
              Continuar {progress}
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => { setAsking(false); }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => { void discardSaved(); }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
              >
                Descartar e começar novo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
