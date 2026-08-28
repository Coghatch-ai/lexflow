import { useState, type ReactElement } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { accuracyPct } from '@shared/domain/scoring';
import type { AiExplanation } from '@shared/domain/ai-eval';
import AiExplanationButton from '@/shared/components/AiExplanationButton';
import { type AnswerDraft, answeredStats } from '@shared/run/exit-rules';
import { shouldShowExplanationToggle } from './real-exam-review-guards';

type ReviewQuestion = {
  id: string;
  correctAnswer: string;
  discipline: string;
  explanation: string;
  aiExplanation: AiExplanation | null;
};

type Lov = { labelOf: (code: string) => string };

interface QuestionReviewRowProps {
  question: ReviewQuestion;
  idx: number;
  userAnswer: string | undefined;
  disciplineLov: Lov;
}

function QuestionReviewRow({ question, idx, userAnswer, disciplineLov }: QuestionReviewRowProps): ReactElement {
  const isCorrect = userAnswer === question.correctAnswer;
  const [expanded, setExpanded] = useState(false);
  const showToggle = shouldShowExplanationToggle(isCorrect);
  const rowCls = isCorrect ? 'bg-green-50 border-green-500' : userAnswer !== undefined ? 'bg-red-50 border-red-500' : 'bg-gray-50 border-gray-400';
  return (
    <div className={`p-3 rounded-lg border-l-4 ${rowCls}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-medium text-gray-800 text-sm">
            Questão {idx + 1} - {disciplineLov.labelOf(question.discipline)}
          </p>
          {!isCorrect && (
            <div className="mt-1 text-xs">
              <p className="text-red-600">Sua resposta: {userAnswer ?? 'Não respondida'}</p>
              <p className="text-green-600">Correta: {question.correctAnswer}</p>
            </div>
          )}
          {showToggle && (
            <>
              <button onClick={() => { setExpanded((v) => !v); }} className="mt-2 text-xs text-[#16161a] font-medium underline">
                {expanded ? 'Ocultar explicação' : 'Ver explicação'}
              </button>
              {expanded && (
                <div className="mt-2 bg-white rounded-lg p-3">
                  <AiExplanationButton questionId={question.id} aiExplanation={question.aiExplanation} explanation={question.explanation} />
                </div>
              )}
            </>
          )}
        </div>
        {isCorrect ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
      </div>
    </div>
  );
}

interface ExamReviewProps {
  questions: ReviewQuestion[];
  /** Answers keyed by QUESTION ID, not by index (epic #67 slice S2d). */
  answersByQuestionId: ReadonlyMap<string, string>;
  drafts: AnswerDraft[];
  timeUsedLabel: string;
  disciplineLov: Lov;
  onReset: () => void;
}

// Result screen of the Simulado Real. The exam can end early via "Encerrar e
// processar respostas" (BR-05.5), so accuracy and the error count are measured
// against what was ANSWERED — an unanswered question is not an error (BR-05.6).
// Every question is still listed, the unanswered ones as "Não respondida".
export default function ExamReview({
  questions,
  answersByQuestionId,
  drafts,
  timeUsedLabel,
  disciplineLov,
  onReset,
}: ExamReviewProps): ReactElement {
  const { answered, correct, wrong } = answeredStats(drafts);
  const accuracy = accuracyPct(correct, answered);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
        <p className="text-white/80">
          Veja como foi seu desempenho nas {answered} de {questions.length} questões respondidas
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
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
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{timeUsedLabel}</div>
          <p className="text-gray-600">Tempo Usado</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Revisão por Questão</h4>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {questions.map((q, idx) => (
            <QuestionReviewRow
              key={q.id}
              question={q}
              idx={idx}
              userAnswer={answersByQuestionId.get(q.id)}
              disciplineLov={disciplineLov}
            />
          ))}
        </div>
      </div>

      <button
        onClick={onReset}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Fazer Outro Simulado Real
      </button>
    </div>
  );
}
