// app/src/components/discursive/DiscursiveFilters.tsx
//
// Mode picker + filter UIs for the 2ª-fase page. Mirrors TestingPage's
// not-started screen (gradient header, white cards, <select> filters fed by
// useLov). Two practice units: single-question and full-prova.

import type { ReactElement } from "react";
import { PenLine, ScrollText } from "lucide-react";
import type { Lov } from "./types";
import { META_SEP } from "@shared/domain/ui-format";

type Prova = { examLabel: string; area: string; year: number };
export type ProvaMode = "single" | "prova";

interface ModeSelectProps {
  onSelect: (mode: ProvaMode) => void;
}

export function DiscursiveModeSelect({ onSelect }: ModeSelectProps): ReactElement {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Segunda Fase — Discursivas</h3>
        <p className="text-white/80">
          Treine a peça prático-profissional e as questões discursivas. Escreva sua resposta,
          compare com o padrão oficial e atribua sua nota.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <button
          onClick={() => { onSelect("single"); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4"><PenLine className="w-6 h-6 text-white" /></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Praticar questões</h4>
          <p className="text-sm text-gray-600">Filtre por área, exame e tipo e responda questões avulsas, uma a uma.</p>
        </button>

        <button
          onClick={() => { onSelect("prova"); }}
          className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
        >
          <div className="bg-[#16161a] p-3 rounded-lg w-fit mb-4"><ScrollText className="w-6 h-6 text-white" /></div>
          <h4 className="text-lg font-bold text-[#16161a] mb-2">Prova completa</h4>
          <p className="text-sm text-gray-600">Resolva uma prova inteira de uma área: 1 peça + 4 discursivas, totalizando 10 pontos.</p>
          <span className="inline-block mt-2 text-xs font-bold text-[#16161a] bg-[#16161a]/10 px-2 py-1 rounded">EXAME</span>
        </button>
      </div>
    </div>
  );
}

interface SingleFiltersProps {
  area: string;
  examLabel: string;
  questionType: string;
  loading: boolean;
  areaLov: Lov;
  questionTypeLov: Lov;
  examLabels: string[];
  onAreaChange: (v: string) => void;
  onExamChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  onBack: () => void;
  onStart: () => void;
}

export function DiscursiveSingleFilters({
  area, examLabel, questionType, loading, areaLov, questionTypeLov, examLabels,
  onAreaChange, onExamChange, onTypeChange, onBack, onStart,
}: SingleFiltersProps): ReactElement {
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
        Voltar aos modos
      </button>

      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Praticar questões</h3>
        <p className="text-white/80">Selecione os filtros e comece a responder questões discursivas reais.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Área</label>
          <select value={area} onChange={(e) => { onAreaChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todas</option>
            {areaLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Exame</label>
          <select value={examLabel} onChange={(e) => { onExamChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todos</option>
            {examLabels.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
          <select value={questionType} onChange={(e) => { onTypeChange(e.target.value); }}
            className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
          >
            <option value="">Todos</option>
            {questionTypeLov.options.map((o) => <option key={o.code} value={o.code}>{o.value}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={loading}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <PenLine className="w-5 h-5" />
        {loading ? "Carregando..." : "Começar"}
      </button>
    </div>
  );
}

interface ProvaPickerProps {
  provas: Prova[];
  selectedKey: string;
  loading: boolean;
  areaLov: Lov;
  onSelectKey: (key: string) => void;
  onBack: () => void;
  onStart: () => void;
}

/** Composite key for a prova option (examLabel|area|year). */
function provaKey(p: Prova): string {
  return `${p.examLabel}|${p.area}|${String(p.year)}`;
}

export function DiscursiveProvaPicker({
  provas, selectedKey, loading, areaLov, onSelectKey, onBack, onStart,
}: ProvaPickerProps): ReactElement {
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition">
        Voltar aos modos
      </button>

      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">Prova completa</h3>
        <p className="text-white/80">Escolha uma prova: você resolverá a peça e as quatro discursivas em sequência.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Prova</label>
        <select value={selectedKey} onChange={(e) => { onSelectKey(e.target.value); }}
          className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
        >
          <option value="">Selecione…</option>
          {provas.map((p) => (
            <option key={provaKey(p)} value={provaKey(p)}>
              {p.examLabel} {META_SEP} {areaLov.labelOf(p.area)} {META_SEP} {p.year}
            </option>
          ))}
        </select>
        {provas.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">Nenhuma prova disponível ainda.</p>
        )}
      </div>

      <button
        onClick={onStart}
        disabled={loading || selectedKey === ""}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <ScrollText className="w-5 h-5" />
        {loading ? "Carregando..." : "Iniciar prova"}
      </button>
    </div>
  );
}
