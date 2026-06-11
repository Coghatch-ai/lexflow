import type { ReactElement } from 'react';

type ExamFinishDialogProps = {
  open: boolean;
  answeredCount: number;
  total: number;
  onClose: () => void;
  onConfirm: () => void;
  onGoToUnanswered: () => void;
};

// Manual finish is blocked while questions remain unanswered — the exam can
// only be submitted early with every question answered. The 5h timer expiry
// is the one path that submits with blanks (handled by the parent).
export default function ExamFinishDialog({
  open,
  answeredCount,
  total,
  onClose,
  onConfirm,
  onGoToUnanswered,
}: ExamFinishDialogProps): ReactElement | null {
  if (!open) return null;
  const unanswered = total - answeredCount;

  if (unanswered > 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-bold text-[#16161a] mb-4">Ainda ha questoes sem resposta</h3>
          <p className="text-gray-600 mb-2">
            Voce respondeu <span className="font-bold">{answeredCount}</span> de {total} questoes.
          </p>
          <p className="text-red-600 text-sm mb-4">
            E preciso responder todas as questoes para encerrar. O simulado e enviado
            automaticamente quando o tempo acabar.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Voltar
            </button>
            <button
              onClick={onGoToUnanswered}
              className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition"
            >
              Ir para nao respondida
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-xl font-bold text-[#16161a] mb-4">Encerrar Simulado?</h3>
        <p className="text-gray-600 mb-4">
          Voce respondeu todas as <span className="font-bold">{total}</span> questoes.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
          >
            Continuar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-[#16161a] text-white py-2 rounded-lg font-semibold hover:bg-[#26262c] transition"
          >
            Encerrar
          </button>
        </div>
      </div>
    </div>
  );
}
