import type { ReactElement } from 'react';

type ExamQuestionNavProps = {
  total: number;
  currentIndex: number;
  answered: ReadonlySet<number>;
  flagged: ReadonlySet<number>;
  postponed: ReadonlySet<number>;
  onSelect: (idx: number) => void;
};

function cellClass(
  idx: number,
  { currentIndex, answered, flagged, postponed }: ExamQuestionNavProps,
): string {
  if (idx === currentIndex || flagged.has(idx)) return 'bg-[#16161a] text-white';
  if (answered.has(idx)) return 'bg-[#26262c] text-white';
  if (postponed.has(idx)) return 'bg-amber-400 text-white';
  return 'bg-gray-100 text-gray-600 hover:bg-gray-200';
}

export default function ExamQuestionNav(props: ExamQuestionNavProps): ReactElement {
  const { total, onSelect } = props;
  return (
    <div className="bg-white rounded-xl p-4 shadow">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Navegacao Rapida</h4>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: total }, (_, idx) => (
          <button
            key={idx}
            onClick={() => { onSelect(idx); }}
            className={`w-full aspect-square rounded text-xs font-medium transition ${cellClass(idx, props)}`}
          >
            {idx + 1}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 flex-wrap">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-[#26262c]" /><span>Respondida</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-[#16161a]" /><span>Sinalizada</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-400" /><span>Adiada</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-gray-100" /><span>Nao respondida</span></div>
      </div>
    </div>
  );
}
