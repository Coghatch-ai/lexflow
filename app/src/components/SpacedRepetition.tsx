import { useEffect, useState } from 'react';
import { useSession } from '../auth';
import { RotateCcw, ChevronRight, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { nextReviewIntervalDays } from '@shared/domain/spaced-repetition';
import { accuracyPct } from '@shared/domain/scoring';
import QuestionCard from '@/shared/components/QuestionCard';

type Status = 'loading' | 'empty' | 'playing' | 'feedback' | 'done';

interface ReviewQuestion {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  discipline: string;
  exam_board: string;
  difficulty: string;
  legislation_title: string;
  lastAnsweredAt: string;
  timesAnswered: number;
  timesCorrect: number;
  nextReviewDate: string;
  intervalDays: number;
}

export default function SpacedRepetition() {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const reviewQuery = trpc.questions.reviewQueue.useQuery();
  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const [status, setStatus] = useState<Status>('loading');
  const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ dueToday: 0, mastered: 0, learning: 0 });
  const [questionTime, setTimeSpent] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);

  // Build the review queue from questions the user has gotten wrong.
  useEffect(() => {
    if (!user || reviewQuery.isLoading) return;
    const data = reviewQuery.data ?? [];
    if (data.length === 0) {
      setStatus('empty');
      return;
    }
    const items: ReviewQuestion[] = data.slice(0, 5).map((q) => ({
      id: q.id,
      question_text: q.questionText,
      options: q.options,
      correct_answer: q.correctAnswer,
      explanation: q.explanation,
      discipline: q.discipline,
      exam_board: q.examBoard,
      difficulty: q.difficulty,
      legislation_title: q.legislationTitle,
      lastAnsweredAt: q.lastAnsweredAt,
      timesAnswered: q.timesAnswered,
      timesCorrect: q.timesCorrect,
      nextReviewDate: new Date().toISOString(),
      intervalDays: 1,
    }));
    setReviewQuestions(items);
    setStats({ dueToday: items.length, mastered: 0, learning: data.length });
    setStatus('playing');
  }, [user, reviewQuery.isLoading, reviewQuery.data]);

  const currentQuestion = reviewQuestions[currentIndex];

  const handleAnswer = () => {
    if (!currentQuestion || !user) return;

    const correct = selectedAnswer === currentQuestion.correct_answer;
    setLastCorrect(correct);
    setAnswerLog((log) => [
      ...log,
      {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent: questionTime,
      },
    ]);

    if (correct) setSessionCorrect((c) => c + 1);
    setSessionTotal((t) => t + 1);

    setStatus('feedback');
  };

  const handleNext = () => {
    if (currentIndex + 1 >= reviewQuestions.length) {
      setStatus('done');
      if (answerLog.length > 0) {
        recordMutation.mutate({
          discipline: currentQuestion?.discipline ?? 'Revisão',
          difficulty: 'medium',
          answers: answerLog,
        });
      }
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer('');
      setLastCorrect(null);
      setTimeSpent(0);
      setStatus('playing');
    }
  };

  // Loading
  if (status === 'loading') {
    return (
      <div className="bg-white rounded-xl p-6 shadow flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
      </div>
    );
  }

  // Empty / No reviews due
  if (status === 'empty') {
    return (
      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-[#16161a] p-3 rounded-lg">
            <RotateCcw className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#16161a]">Revisao Espacada</h3>
            <p className="text-sm text-gray-600">Revise no momento certo para maximizar retencao</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#16161a]/5 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-[#16161a]">{stats.dueToday}</p>
            <p className="text-sm text-gray-600">Revisoes Hoje</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.mastered}</p>
            <p className="text-sm text-gray-600">Dominadas</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{stats.learning}</p>
            <p className="text-sm text-gray-600">Aprendendo</p>
          </div>
        </div>

        <div className="text-center py-8">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 mb-2">Nenhuma revisao pendente!</p>
          <p className="text-sm text-gray-500">
            Responda simulados primeiro para que o sistema identifique questoes para revisar.
          </p>
        </div>

        <div className="bg-[#16161a]/5 rounded-lg p-4">
          <h4 className="font-semibold text-[#16161a] mb-2">Como funciona?</h4>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>- Questoes respondidas incorretamente entram na fila de revisao</li>
            <li>- Intervalos: 1 dia, 3 dias, 7 dias, 14 dias, 30 dias</li>
            <li>- Acerto: avanca para o proximo intervalo</li>
            <li>- Erro: volta ao intervalo de 1 dia</li>
            <li>- Apos 3 acertos seguidos, a questao e considerada dominada</li>
          </ul>
        </div>
      </div>
    );
  }

  // Playing
  if (status === 'playing' && currentQuestion) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
          <div className="flex items-center gap-3">
            <RotateCcw className="w-5 h-5 text-[#16161a]" />
            <span className="text-sm font-medium text-gray-700">
              Revisao {currentIndex + 1} de {reviewQuestions.length}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            Ultima resposta: {new Date(currentQuestion.lastAnsweredAt).toLocaleDateString('pt-BR')}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-600">
              {currentQuestion.timesCorrect}/{currentQuestion.timesAnswered} acertos anteriores
            </span>
          </div>

          <QuestionCard
            disciplineLabel={disciplineLov.labelOf(currentQuestion.discipline)}
            examBoardLabel={examBoardLov.labelOf(currentQuestion.exam_board)}
            questionText={currentQuestion.question_text}
            options={currentQuestion.options}
            selectedAnswer={selectedAnswer}
            onSelect={setSelectedAnswer}
          />

          <button
            onClick={handleAnswer}
            disabled={!selectedAnswer}
            className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            Confirmar
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Feedback
  if (status === 'feedback' && currentQuestion) {
    const nextInterval = nextReviewIntervalDays(
      currentQuestion.intervalDays,
      lastCorrect ?? false
    );

    return (
      <div className="space-y-4">
        <div className={`rounded-xl p-6 shadow ${lastCorrect ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            {lastCorrect ? (
              <CheckCircle className="w-8 h-8 text-green-600" />
            ) : (
              <XCircle className="w-8 h-8 text-red-600" />
            )}
            <h3 className="text-xl font-bold text-[#16161a]">
              {lastCorrect ? 'Correto!' : 'Incorreto'}
            </h3>
          </div>

          {!lastCorrect && (
            <div className="mb-4 bg-white rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Resposta correta:</p>
              <p className="font-semibold text-green-700">{currentQuestion.correct_answer}</p>
            </div>
          )}

          <div className="bg-white rounded-lg p-4 mb-4">
            <p className="text-gray-800">{currentQuestion.explanation}</p>
          </div>

          <div className="bg-white rounded-lg p-4 flex items-center gap-3">
            <Calendar className="w-5 h-5 text-[#16161a]" />
            <div>
              <p className="text-sm text-gray-600">Proxima revisao em</p>
              <p className="font-bold text-[#16161a]">{nextInterval} dia{nextInterval > 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleNext}
          className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
        >
          {currentIndex + 1 >= reviewQuestions.length ? 'Concluir Revisao' : 'Proxima Revisao'}
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Done
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Revisao Concluida!</h3>
        <p className="text-white/80">Continue revisando regularmente para maximizar retencao</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2">{sessionCorrect}</div>
          <p className="text-gray-600">Acertos de {sessionTotal}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">
            {accuracyPct(sessionCorrect, sessionTotal)}%
          </div>
          <p className="text-gray-600">Acuracia na Sessao</p>
        </div>
      </div>

      <button
        onClick={() => {
          setStatus('empty');
        }}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Recarregar Revisoes
      </button>
    </div>
  );
}
