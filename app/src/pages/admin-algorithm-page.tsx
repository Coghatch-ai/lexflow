import { useState, type ReactElement } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { AdminGate } from './admin-gate';

function AlgorithmConfig(): ReactElement {
  const configQuery = trpc.admin.spacedRepetition.getConfig.useQuery();
  const updateMutation = trpc.admin.spacedRepetition.updateConfig.useMutation({
    onSuccess: () => { setSaved(true); },
  });
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    defaultEaseFactor: 2.5,
    minEaseFactor: 1.3,
    easeFactorCorrectBonus: 0.1,
    easeFactorWrongPenalty: 0.2,
    initialInterval: 1,
    secondInterval: 6,
  });

  const [loaded, setLoaded] = useState(false);
  if (configQuery.data && !loaded) {
    setLoaded(true);
    setForm({
      defaultEaseFactor: configQuery.data.defaultEaseFactor,
      minEaseFactor: configQuery.data.minEaseFactor,
      easeFactorCorrectBonus: configQuery.data.easeFactorCorrectBonus,
      easeFactorWrongPenalty: configQuery.data.easeFactorWrongPenalty,
      initialInterval: configQuery.data.initialInterval,
      secondInterval: configQuery.data.secondInterval,
    });
  }

  function handleChange(key: keyof typeof form, value: string) {
    setSaved(false);
    const parsed = parseFloat(value);
    setForm((f) => ({ ...f, [key]: Number.isNaN(parsed) ? 0 : parsed }));
  }

  function handleSave() {
    updateMutation.mutate(form);
  }

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-ink-mute">Carregando...</div>
    );
  }

  const fields: Array<{
    key: keyof typeof form;
    label: string;
    description: string;
    step: string;
    min: number;
    max: number;
  }> = [
    { key: 'defaultEaseFactor', label: 'Fator de facilidade inicial', description: 'EF inicial para questões novas. Padrão Anki: 2.5', step: '0.05', min: 1.0, max: 5.0 },
    { key: 'minEaseFactor', label: 'Fator de facilidade mínimo', description: 'Floor para EF — evita intervalos muito curtos mesmo para questões difíceis. Padrão: 1.3', step: '0.05', min: 1.0, max: 3.0 },
    { key: 'easeFactorCorrectBonus', label: 'Bônus por acerto (EF)', description: 'Quanto o EF aumenta a cada acerto. Padrão: 0.10', step: '0.01', min: 0, max: 1.0 },
    { key: 'easeFactorWrongPenalty', label: 'Penalidade por erro (EF)', description: 'Quanto o EF diminui a cada erro. Padrão: 0.20', step: '0.01', min: 0, max: 1.0 },
    { key: 'initialInterval', label: 'Intervalo inicial (dias)', description: 'Dias até a próxima revisão após o 1º acerto. Padrão: 1', step: '1', min: 1, max: 7 },
    { key: 'secondInterval', label: 'Segundo intervalo (dias)', description: 'Dias até a próxima revisão após o 2º acerto. Padrão: 6', step: '1', min: 2, max: 60 },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-mute">Ajuste os parâmetros SM-2 da revisão espaçada. Valores afetam novos cálculos imediatamente.</p>

      <div className="grid gap-4">
        {fields.map((f) => (
          <div key={f.key} className="bg-line/30 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-semibold text-ink">{f.label}</label>
                <p className="text-xs text-ink-mute mt-0.5">{f.description}</p>
              </div>
              <input
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={form[f.key]}
                onChange={(e) => { handleChange(f.key, e.target.value); }}
                className="w-24 text-right px-3 py-1.5 border border-line rounded-lg text-sm font-mono bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Salvando...' : 'Salvar configuração'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="w-4 h-4" />
            Salvo com sucesso
          </span>
        )}
        {updateMutation.isError && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            Erro ao salvar
          </span>
        )}
      </div>

      <div className="bg-[#16161a]/5 rounded-lg p-4 text-sm text-ink-mute space-y-1">
        <p className="font-semibold text-ink">Como o SM-2 funciona:</p>
        <p>Após o 1º acerto: {form.initialInterval} dia(s). Após o 2º: {form.secondInterval} dia(s).</p>
        <p>A partir do 3º acerto: intervalo = round(intervalo anterior × EF atual).</p>
        <p>EF começa em {form.defaultEaseFactor.toFixed(2)}, sobe +{form.easeFactorCorrectBonus.toFixed(2)} por acerto, cai -{form.easeFactorWrongPenalty.toFixed(2)} por erro (mínimo {form.minEaseFactor.toFixed(2)}).</p>
      </div>
    </div>
  );
}

export function AdminAlgorithmPage(): ReactElement {
  return <AdminGate><AlgorithmConfig /></AdminGate>;
}
