import { useEffect, useState, type ReactElement } from 'react';
import { useSession } from '../auth';
import { RotateCcw, ChevronRight, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { shuffle } from '../shared/lib/shuffle';
import { accuracyPct } from '@shared/domain/scoring';
import { useNotesAndBookmarks } from '../shared/hooks/use-notes-bookmarks';
import QuestionCard from '@/shared/components/QuestionCard';

type Status = 'loading' | 'empty' | 'playing' | 'feedback' | 'done';

type ReviewItem = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  discipline: string;
  examBoard: string;
  difficulty: string;
  legislationTitle: string | null;
  interval: number;
  repetitions: number;
  nextReviewAt: string;
  lastCorrect: boolean | null;
};

function SpacedEmptyState({ dueCount }: { dueCount: number }): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#16161a] p-3 rounded-lg">
          <RotateCcw className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-[#16161a]">Revisão Espaçada</h3>
          <p className="text-sm text-gray-600">Revise no momento certo para maximizar retenção</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#16161a]/5 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-[#16161a]">{dueCount}</p>
          <p className="text-sm text-gray-600">Revisões Pendentes</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-600">0</p>
          <p className="text-sm text-gray-600">Para Revisar Hoje</p>
        </div>
      </div>

      <div className="text-center py-8">
        <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 mb-2">Nenhuma revisão pendente!</p>
        <p className="text-sm text-gray-500">
          Responda simulados primeiro para que o sistema identifique questões para revisar.
        </p>
      </div>

      <div className="bg-[#16161a]/5 rounded-lg p-4">
        <h4 className="font-semibold text-[#16161a] mb-2">Como funciona?</h4>
        <ul className="space-y-1 text-sm text-gray-700">
          <li>- Questões respondidas incorretamente entram na fila de revisão</li>
          <li>- O algoritmo SM-2 ajusta o intervalo conforme seu desempenho</li>
          <li>- Acerto: intervalo aumenta (1 dia → 6 dias → progressivo)</li>
          <li>- Erro: intervalo volta ao início</li>
          <li>- Quanto mais você acerta, mais tempo até a próxima revisão</li>
        </ul>
      </div>
    </div>
  );
}

export default function SpacedRepetition(): ReactElement {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const reviewQuery = trpc.questions.reviewQueue.useQuery();
  const dueCountQuery = trpc.questions.dueCount.useQuery();
  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
      void utils.questions.invalidate();
    },
  });

  const { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark } = useNotesAndBookmarks();

  const [status, setStatus] = useState<Status>('loading');
  const [reviewQuestions, setReviewQuestions] = useState<ReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [nextIntervalDays, setNextIntervalDays] = useState<number>(1);
  const [questionTime, setTimeSpent] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);

  // Map the review queue into session state only while in 'loading' status and
  // never against an in-flight fetch: background refetches (window focus after
  // staleTime, invalidate on record) must not replace — and reshuffle — the
  // questions mid-session.
  useEffect(() => {
    if (!user || status !== 'loading' || reviewQuery.isFetching) return;
    const data = reviewQuery.data ?? [];
    if (data.length === 0) {
      setStatus('empty');
      return;
    }
    const items: ReviewItem[] = data.slice(0, 5).map((q) => ({
      id: q.id,
      questionText: q.questionText,
      options: shuffle(q.options),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      discipline: q.discipline,
      examBoard: q.examBoard,
      difficulty: q.difficulty,
      legislationTitle: q.legislationTitle,
      interval: q.interval,
      repetitions: q.repetitions,
      nextReviewAt: q.nextReviewAt,
      lastCorrect: q.lastCorrect ?? null,
    }));
    setReviewQuestions(items);
    setStatus('playing');
  }, [user, status, reviewQuery.isFetching, reviewQuery.data]);

  const currentQuestion = reviewQuestions[currentIndex];
  const dueCount = dueCountQuery.data?.count ?? 0;

  const handleAnswer = () => {
    if (!user || currentIndex >= reviewQuestions.length) return;

    const correct = selectedAnswer === currentQuestion.correctAnswer;
    setLastCorrect(correct);

    const reps = currentQuestion.repetitions;
    let displayInterval: number;
    if (!correct) {
      displayInterval = 1;
    } else if (reps === 0) {
      displayInterval = 1;
    } else if (reps === 1) {
      displayInterval = 6;
    } else {
      displayInterval = Math.round(currentQuestion.interval * 2.5);
    }
    setNextIntervalDays(displayInterval);

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
          discipline: currentQuestion.discipline,
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

  if (status === 'loading') {
    return (
      <div className="bg-white rounded-xl p-6 shadow flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
      </div>
    );
  }

  if (status === 'empty') {
    return <SpacedEmptyState dueCount={dueCount} />;
  }

  if (status === 'playing') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
          <div className="flex items-center gap-3">
            <RotateCcw className="w-5 h-5 text-[#16161a]" />
            <span className="text-sm font-medium text-gray-700">
              Revisão {currentIndex + 1} de {reviewQuestions.length}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            {currentQuestion.repetitions} acerto{currentQuestion.repetitions !== 1 ? 's' : ''} consecutivo{currentQuestion.repetitions !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow">
          <QuestionCard
            disciplineLabel={disciplineLov.labelOf(currentQuestion.discipline)}
            examBoardLabel={examBoardLov.labelOf(currentQuestion.examBoard)}
            questionText={currentQuestion.questionText}
            options={currentQuestion.options}
            selectedAnswer={selectedAnswer}
            onSelect={setSelectedAnswer}
            note={localNotes.get(currentQuestion.id) ?? ''}
            onNoteChange={(text) => { handleNoteChange(currentQuestion.id, text); }}
            isBookmarked={bookmarkedIds.has(currentQuestion.id)}
            onToggleBookmark={() => { handleToggleBookmark(currentQuestion.id); }}
          />

          <button
            onClick={handleAnswer}
            disabled={selectedAnswer.length === 0}
            className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            Confirmar
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  if (status === 'feedback') {
    return (
      <div className="space-y-4">
        <div className={`rounded-xl p-6 shadow ${lastCorrect === true ? 'bg-green-50 border-2 border-green-200' : 'bg-red-50 border-2 border-red-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            {lastCorrect === true ? (
              <CheckCircle className="w-8 h-8 text-green-600" />
            ) : (
              <XCircle className="w-8 h-8 text-red-600" />
            )}
            <h3 className="text-xl font-bold text-[#16161a]">
              {lastCorrect === true ? 'Correto!' : 'Incorreto'}
            </h3>
          </div>

          {lastCorrect !== true && (
            <div className="mb-4 bg-white rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Resposta correta:</p>
              <p className="font-semibold text-green-700">{currentQuestion.correctAnswer}</p>
            </div>
          )}

          <div className="bg-white rounded-lg p-4 mb-4">
            <p className="text-gray-800">{currentQuestion.explanation}</p>
          </div>

          <div className="bg-white rounded-lg p-4 flex items-center gap-3">
            <Calendar className="w-5 h-5 text-[#16161a]" />
            <div>
              <p className="text-sm text-gray-600">Próxima revisão agendada em</p>
              <p className="font-bold text-[#16161a]">
                {nextIntervalDays} dia{nextIntervalDays > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleNext}
          className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
        >
          {currentIndex + 1 >= reviewQuestions.length ? 'Concluir Revisão' : 'Próxima Revisão'}
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Revisão Concluída!</h3>
        <p className="text-white/80">Continue revisando regularmente para maximizar retenção</p>
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
          <p className="text-gray-600">Acurácia na Sessão</p>
        </div>
      </div>

      <button
        onClick={() => {
          void reviewQuery.refetch();
          setStatus('loading');
          setCurrentIndex(0);
          setAnswerLog([]);
          setSessionCorrect(0);
          setSessionTotal(0);
        }}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Recarregar Revisões
      </button>
    </div>
  );
}
