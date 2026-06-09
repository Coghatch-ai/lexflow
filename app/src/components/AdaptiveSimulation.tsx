import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../auth';
import { Brain, ChevronRight, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { nextDifficulty } from '@shared/domain/adaptive';
import { accuracyPct } from '@shared/domain/scoring';
import QuestionCard from '@/shared/components/QuestionCard';

type Difficulty = 'easy' | 'medium' | 'hard';
type Status = 'setup' | 'playing' | 'feedback' | 'finished';

interface Question {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  difficulty: Difficulty;
  discipline: string;
  exam_board: string;
  explanation: string;
  legislation_title: string | null;
  legislation_link: string | null;
}

interface AdaptiveState {
  currentDifficulty: Difficulty;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  totalCorrect: number;
  totalAnswered: number;
  difficultyHistory: Difficulty[];
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

export default function AdaptiveSimulation() {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
  const [status, setStatus] = useState<Status>('setup');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [adaptive, setAdaptive] = useState<AdaptiveState>({
    currentDifficulty: 'medium',
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    totalCorrect: 0,
    totalAnswered: 0,
    difficultyHistory: [],
  });
  const [questionPool, setQuestionPool] = useState<Question[]>([]);
  const [questionTime, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [answerLog, setAnswerLog] = useState<
    { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  >([]);

  const utils = trpc.useUtils();
  const recordMutation = trpc.sessions.record.useMutation({
    onSuccess: () => {
      void utils.stats.invalidate();
      void utils.sessions.invalidate();
    },
  });

  const notesQuery = trpc.notes.list.useQuery();
  const bookmarksQuery = trpc.bookmarks.list.useQuery();
  const notesMutation = trpc.notes.upsert.useMutation();
  const deleteNoteMutation = trpc.notes.delete.useMutation();
  const bookmarksMutation = trpc.bookmarks.toggle.useMutation();
  const [localNotes, setLocalNotes] = useState<Map<string, string>>(new Map());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notesQuery.data) return;
    const map = new Map<string, string>();
    notesQuery.data.forEach((n) => map.set(n.questionId, n.noteText));
    setLocalNotes(map);
  }, [notesQuery.data]);

  useEffect(() => {
    if (!bookmarksQuery.data) return;
    setBookmarkedIds(new Set(bookmarksQuery.data));
  }, [bookmarksQuery.data]);

  useEffect(() => {
    return () => {
      if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    };
  }, []);

  const handleNoteChange = (questionId: string, text: string) => {
    setLocalNotes((prev) => new Map(prev).set(questionId, text));
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      if (text.trim().length > 0) {
        notesMutation.mutate({ questionId, noteText: text });
      } else {
        deleteNoteMutation.mutate({ questionId });
      }
    }, 1000);
  };

  const handleToggleBookmark = (questionId: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
    bookmarksMutation.mutate({ questionId });
  };

  const currentQuestion = questions[currentIndex];

  // Timer
  useEffect(() => {
    if (status === 'playing' && currentIndex < questions.length) {
      const interval = setInterval(() => {
        setTimer((t) => t + 1);
        setTimeSpent((t) => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, currentIndex, questions.length]);

  // Picks the next unseen question at the given difficulty from the fetched pool.
  const fetchQuestion = useCallback(
    (difficulty: Difficulty): Question | null => {
      const answeredIds = questions.map((q) => q.id);
      const unseen = questionPool.filter((q) => !answeredIds.includes(q.id));
      const atDifficulty = unseen.filter((q) => q.difficulty === difficulty);
      const fromPool = atDifficulty.length > 0 ? atDifficulty : unseen;
      if (fromPool.length === 0) return null;
      return fromPool[Math.floor(Math.random() * fromPool.length)];
    },
    [questionPool, questions]
  );

  const startSimulation = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: selectedDiscipline !== '' ? selectedDiscipline : undefined,
        limit: 100,
      });
      const mapped: Question[] = rows.map((r) => ({
        id: r.id,
        question_text: r.questionText,
        options: r.options,
        correct_answer: r.correctAnswer,
        difficulty: r.difficulty as Difficulty,
        discipline: r.discipline,
        exam_board: r.examBoard,
        explanation: r.explanation,
        legislation_title: r.legislationTitle,
        legislation_link: r.legislationLink,
      }));
      setQuestionPool(mapped);

      const startDifficulty: Difficulty = 'medium';
      const startPool = mapped.filter((q) => q.difficulty === startDifficulty);
      const firstQuestion = (startPool.length > 0 ? startPool : mapped)[0] ?? null;
      if (firstQuestion) {
        setQuestions([firstQuestion]);
        setAnswerLog([]);
        setAdaptive({
          currentDifficulty: startDifficulty,
          consecutiveCorrect: 0,
          consecutiveWrong: 0,
          totalCorrect: 0,
          totalAnswered: 0,
          difficultyHistory: [startDifficulty],
        });
        setCurrentIndex(0);
        setSelectedAnswer('');
        setTimeSpent(0);
        setTimer(0);
        setLastCorrect(null);
        setStatus('playing');
      }
    } finally {
      setLoading(false);
    }
  };

  const finish = (
    log: { questionId: string; userAnswer: string; correct: boolean; timeSpent: number }[]
  ) => {
    setStatus('finished');
    if (log.length > 0) {
      recordMutation.mutate({
        discipline: selectedDiscipline !== '' ? selectedDiscipline : 'Geral',
        difficulty: adaptive.currentDifficulty,
        answers: log,
      });
    }
  };

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

    const newConsecutiveCorrect = correct ? adaptive.consecutiveCorrect + 1 : 0;
    const newConsecutiveWrong = correct ? 0 : adaptive.consecutiveWrong + 1;

    setAdaptive({
      currentDifficulty: adaptive.currentDifficulty,
      consecutiveCorrect: newConsecutiveCorrect,
      consecutiveWrong: newConsecutiveWrong,
      totalCorrect: adaptive.totalCorrect + (correct ? 1 : 0),
      totalAnswered: adaptive.totalAnswered + 1,
      difficultyHistory: [...adaptive.difficultyHistory, adaptive.currentDifficulty],
    });
    setStatus('feedback');
  };

  const handleNext = () => {
    if (adaptive.totalAnswered >= totalQuestions) {
      finish(answerLog);
      return;
    }

    const nextDiff = nextDifficulty(
      adaptive.currentDifficulty,
      adaptive.consecutiveCorrect,
      adaptive.consecutiveWrong
    );
    const nextQuestion = fetchQuestion(nextDiff);

    if (nextQuestion) {
      setAdaptive((prev) => ({
        ...prev,
        currentDifficulty: nextDiff,
        difficultyHistory: [...prev.difficultyHistory, nextDiff],
      }));
      setQuestions((prev) => [...prev, nextQuestion]);
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer('');
      setTimeSpent(0);
      setLastCorrect(null);
      setStatus('playing');
    } else {
      finish(answerLog);
    }
  };

  // Setup screen
  if (status === 'setup') {
    return (
      <div className="bg-white rounded-xl p-6 shadow">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-[#16161a] p-3 rounded-lg">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#16161a]">Simulado Adaptativo</h3>
            <p className="text-sm text-gray-600">
              A dificuldade ajusta automaticamente conforme seu desempenho
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Disciplina (opcional)
            </label>
            <select
              value={selectedDiscipline}
              onChange={(e) => setSelectedDiscipline(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
            >
              <option value="">Todas as disciplinas</option>
              {disciplineLov.options.map((o) => (
                <option key={o.code} value={o.code}>{o.value}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Numero de questoes: {totalQuestions}
            </label>
            <input
              type="range"
              min="5"
              max="30"
              value={totalQuestions}
              onChange={(e) => setTotalQuestions(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>5</span>
              <span>15</span>
              <span>30</span>
            </div>
          </div>
        </div>

        <div className="bg-[#16161a]/5 rounded-lg p-4 mb-6">
          <h4 className="font-semibold text-[#16161a] mb-2">Como funciona?</h4>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>- Comeca no nivel medio</li>
            <li>- 2 acertos seguidos: sobe a dificuldade</li>
            <li>- 2 erros seguidos: diminui a dificuldade</li>
            <li>- Ajuste automatico em tempo real</li>
          </ul>
        </div>

        <button
          onClick={startSimulation}
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Zap className="w-5 h-5" />
          {loading ? 'Carregando...' : 'Iniciar Simulado Adaptativo'}
        </button>
      </div>
    );
  }

  // Playing screen
  if (status === 'playing' && currentQuestion) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-white rounded-xl p-4 shadow">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-[#16161a]" />
            <span className="text-sm font-medium text-gray-700">Nivel atual:</span>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${DIFFICULTY_COLORS[adaptive.currentDifficulty]}`}>
              {difficultyLov.labelOf(adaptive.currentDifficulty)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Questao {adaptive.totalAnswered + 1} de {totalQuestions}</span>
            <span>{adaptive.totalCorrect}/{adaptive.totalAnswered} acertos</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-[#16161a] to-[#26262c] h-2 rounded-full transition-all"
              style={{ width: `${(adaptive.totalAnswered / totalQuestions) * 100}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow">
          <QuestionCard
            disciplineLabel={disciplineLov.labelOf(currentQuestion.discipline)}
            examBoardLabel={examBoardLov.labelOf(currentQuestion.exam_board)}
            questionText={currentQuestion.question_text}
            options={currentQuestion.options}
            selectedAnswer={selectedAnswer}
            onSelect={setSelectedAnswer}
            note={localNotes.get(currentQuestion.id) ?? ''}
            onNoteChange={(text) => handleNoteChange(currentQuestion.id, text)}
            isBookmarked={bookmarkedIds.has(currentQuestion.id)}
            onToggleBookmark={() => handleToggleBookmark(currentQuestion.id)}
          />

          <button
            onClick={handleAnswer}
            disabled={!selectedAnswer}
            className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            Confirmar Resposta
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Feedback screen
  if (status === 'feedback' && currentQuestion) {
    const nextDiff = nextDifficulty(
      adaptive.currentDifficulty,
      adaptive.consecutiveCorrect,
      adaptive.consecutiveWrong
    );
    const difficultyChanged = nextDiff !== adaptive.currentDifficulty;

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
              {lastCorrect ? 'Resposta Correta!' : 'Resposta Incorreta'}
            </h3>
          </div>

          {!lastCorrect && (
            <div className="mb-4 bg-white rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Resposta correta:</p>
              <p className="font-semibold text-green-700">{currentQuestion.correct_answer}</p>
            </div>
          )}

          <div className="bg-white rounded-lg p-4">
            <p className="text-sm font-medium text-gray-700 mb-1">Explicacao:</p>
            <p className="text-gray-800">{currentQuestion.explanation}</p>
            <p className="text-sm text-[#16161a] mt-2 font-medium">
              {currentQuestion.legislation_title}
            </p>
          </div>
        </div>

        {difficultyChanged && (
          <div className="bg-[#16161a]/10 border-2 border-[#16161a] rounded-xl p-4 flex items-center gap-3">
            <Zap className="w-5 h-5 text-[#16161a]" />
            <div>
              <p className="font-semibold text-[#16161a]">Dificuldade ajustada!</p>
              <p className="text-sm text-gray-700">
                De <span className={`font-bold ${DIFFICULTY_COLORS[adaptive.currentDifficulty]}`}>{difficultyLov.labelOf(adaptive.currentDifficulty)}</span> para{' '}
                <span className={`font-bold ${DIFFICULTY_COLORS[nextDiff]}`}>{difficultyLov.labelOf(nextDiff)}</span>
              </p>
            </div>
          </div>
        )}

        <button
          onClick={handleNext}
          className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
        >
          {adaptive.totalAnswered >= totalQuestions ? 'Ver Resultado' : 'Proxima Questao'}
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Finished screen
  const accuracy = accuracyPct(adaptive.totalCorrect, adaptive.totalAnswered);

  const easyCount = adaptive.difficultyHistory.filter((d) => d === 'easy').length;
  const medCount = adaptive.difficultyHistory.filter((d) => d === 'medium').length;
  const hardCount = adaptive.difficultyHistory.filter((d) => d === 'hard').length;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Adaptativo Finalizado!</h3>
        <p className="text-white/80">Veja como seu desempenho evoluiu</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{accuracy}%</div>
          <p className="text-gray-600">Acuracia Final</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2">{adaptive.totalCorrect}</div>
          <p className="text-gray-600">Acertos de {adaptive.totalAnswered}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</div>
          <p className="text-gray-600">Tempo Total</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Distribuicao de Dificuldade</h4>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-16 text-sm font-medium text-gray-700">Facil</span>
            <div className="flex-1 bg-gray-200 rounded-full h-4">
              <div className="bg-green-500 h-4 rounded-full" style={{ width: `${(easyCount / adaptive.difficultyHistory.length) * 100}%` }} />
            </div>
            <span className="w-8 text-sm font-bold text-gray-700">{easyCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-16 text-sm font-medium text-gray-700">Medio</span>
            <div className="flex-1 bg-gray-200 rounded-full h-4">
              <div className="bg-yellow-500 h-4 rounded-full" style={{ width: `${(medCount / adaptive.difficultyHistory.length) * 100}%` }} />
            </div>
            <span className="w-8 text-sm font-bold text-gray-700">{medCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-16 text-sm font-medium text-gray-700">Dificil</span>
            <div className="flex-1 bg-gray-200 rounded-full h-4">
              <div className="bg-red-500 h-4 rounded-full" style={{ width: `${(hardCount / adaptive.difficultyHistory.length) * 100}%` }} />
            </div>
            <span className="w-8 text-sm font-bold text-gray-700">{hardCount}</span>
          </div>
        </div>
      </div>

      <button
        onClick={() => {
          setStatus('setup');
          setQuestions([]);
          setAdaptive({
            currentDifficulty: 'medium',
            consecutiveCorrect: 0,
            consecutiveWrong: 0,
            totalCorrect: 0,
            totalAnswered: 0,
            difficultyHistory: [],
          });
        }}
        className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
      >
        Fazer Outro Simulado Adaptativo
      </button>
    </div>
  );
}
