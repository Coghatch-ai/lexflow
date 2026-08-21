import type { ReactElement } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { accuracyPct } from '@shared/domain/scoring';
import AiExplanationButton from '@/shared/components/AiExplanationButton';
import { type AnswerDraft, answeredStats, rowsForAnswers } from '@/shared/lib/exit-rules';

type CompletedQuestion = {
  id: string;
  discipline: string;
  explanation: string;
};

interface TestCompletedProps {
  questions: CompletedQuestion[];
  answers: AnswerDraft[];
  disciplineLov: { labelOf: (code: string) => string };
  onSwitchMode: () => void;
  onRestart: () => void;
}

// Result screen of the Simulado Padrão. A run can end early via "Sair e
// processar respostas" (BR-05), so it is driven by the ANSWERS, never by the
// question queue: the denominators are what was answered, and the summary is
// the id-join from `exit-rules`. Indexing `answers[idx]` per question here used
// to throw on any partial run.
export default function TestCompleted({
  questions,
  answers,
  disciplineLov,
  onSwitchMode,
  onRestart,
}: TestCompletedProps): ReactElement {
  const { answered, correct, wrong } = answeredStats(answers);
  const accuracy = accuracyPct(correct, answered);
  const rows = rowsForAnswers(questions, answers);
  const partial = answered < questions.length;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
        <p className="text-white/80">
          {partial
            ? `Seus resultados foram salvos: ${String(answered)} de ${String(questions.length)} questões respondidas.`
            : 'Seus resultados foram salvos com sucesso.'}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{accuracy}%</div>
          <p className="text-gray-600">Acurácia</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2 flex items-center justify-center gap-2">
            <CheckCircle className="w-8 h-8" />{correct}
          </div>
          <p className="text-gray-600">Acertos de {answered}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-red-600 mb-2 flex items-center justify-center gap-2">
            <XCircle className="w-8 h-8" />{wrong}
          </div>
          <p className="text-gray-600">Erros</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Resumo das Questões</h4>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {rows.map(({ question, answer }, idx) => (
            <div
              key={question.id}
              className={`p-3 rounded-lg border-l-4 ${answer.correct ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-gray-800">Questão {idx + 1}</p>
                  <p className="text-sm text-gray-600">{disciplineLov.labelOf(question.discipline)}</p>
                </div>
                {answer.correct
                  ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
              </div>
              <AiExplanationButton questionId={question.id} explanation={question.explanation} aiExplanation={null} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSwitchMode}
          className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Trocar Modo
        </button>
        <button
          onClick={onRestart}
          className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
        >
          Refazer Simulado
        </button>
      </div>
    </div>
  );
}
