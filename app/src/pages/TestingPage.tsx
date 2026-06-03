import { useState, useEffect, useRef } from 'react';
import { useSession } from '../auth';
import { Clock, CheckCircle, XCircle, ChevronRight, BookOpen } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import AdaptiveSimulation from '../components/AdaptiveSimulation';
import SpacedRepetition from '../components/SpacedRepetition';
import RealExamSimulation from '../components/RealExamSimulation';
import { trpc } from '../shared/lib/trpc';
import { accuracyPct } from '@shared/domain/scoring';
import QuestionCard from '@/shared/components/QuestionCard';

type Mode = 'standard' | 'adaptive' | 'spaced' | 'real';
type QuestionStatus = 'not-started' | 'in-progress' | 'completed';

interface Question {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  difficulty: string;
  discipline: string;
  exam_board: string;
  explanation: string;
  legislation_title: string;
  legislation_link: string;
}

interface Answer {
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpent: number;
}

export default function TestingPage() {
  const { user } = useSession();
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const difficultyLov = useLov('DIFFICULTY');
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

  const [mode, setMode] = useState<Mode | null>(null);
  const [status, setStatus] = useState<QuestionStatus>('not-started');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [timer, setTimer] = useState(0);

  // Filters
  const [discipline, setDiscipline] = useState('');
  const [examBoard, setExamBoard] = useState('');
  const [difficulty, setDifficulty] = useState('');

  // Timer
  useEffect(() => {
    if (status === 'in-progress' && currentIndex < questions.length) {
      const interval = setInterval(() => {
        setTimer((t) => t + 1);
        setTimeSpent((t) => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status, currentIndex, questions.length]);

  // If a special mode is selected, render that component
  if (mode === 'adaptive') return <AdaptiveSimulation />;
  if (mode === 'spaced') return <SpacedRepetition />;
  if (mode === 'real') return <RealExamSimulation />;

  // Mode selection
  if (!mode) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
          <h3 className="text-xl font-bold mb-2">Escolha o Modo de Estudo</h3>
          <p className="text-white/80">
            Selecione o tipo de simulado que melhor atende suas necessidades
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Standard */}
          <button
            onClick={() => setMode('standard')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
          >
            <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Padrao</h4>
            <p className="text-sm text-gray-600">
              10 questoes com filtros por disciplina, banca e dificuldade. Feedback imediato.
            </p>
          </button>

          {/* Adaptive */}
          <button
            onClick={() => setMode('adaptive')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
          >
            <div className="bg-[#16161a] p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">A</span>
            </div>
            <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Adaptativo</h4>
            <p className="text-sm text-gray-600">
              Dificuldade ajusta automaticamente conforme seu desempenho em tempo real.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-[#16161a] bg-[#16161a]/10 px-2 py-1 rounded">INTELIGENTE</span>
          </button>

          {/* Spaced Repetition */}
          <button
            onClick={() => setMode('spaced')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-[#16161a]"
          >
            <div className="bg-[#26262c] p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">R</span>
            </div>
            <h4 className="text-lg font-bold text-[#16161a] mb-2">Revisao Espacada</h4>
            <p className="text-sm text-gray-600">
              Revise questoes nos intervalos ideais para maximizar retencao a longo prazo.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-[#26262c] bg-[#26262c]/10 px-2 py-1 rounded">RETENCAO</span>
          </button>

          {/* Real Exam */}
          <button
            onClick={() => setMode('real')}
            className="bg-white rounded-xl p-6 shadow hover:shadow-lg transition text-left border-2 border-transparent hover:border-red-400"
          >
            <div className="bg-red-600 p-3 rounded-lg w-fit mb-4">
              <span className="text-white text-xl font-bold">P</span>
            </div>
            <h4 className="text-lg font-bold text-[#16161a] mb-2">Simulado Prova Real</h4>
            <p className="text-sm text-gray-600">
              80 questoes, 5 horas, sem feedback. Simule as condicoes reais do exame.
            </p>
            <span className="inline-block mt-2 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">INTENSO</span>
          </button>
        </div>
      </div>
    );
  }

  // Load questions from the API (random 10 matching the filters).
  const loadQuestions = async () => {
    setLoading(true);
    try {
      const rows = await utils.questions.list.fetch({
        discipline: discipline !== '' ? discipline : undefined,
        examBoard: examBoard !== '' ? (examBoard as 'FGV' | 'CESPE') : undefined,
        difficulty: difficulty !== '' ? (difficulty as 'easy' | 'medium' | 'hard') : undefined,
        limit: 10,
      });

      const mapped: Question[] = rows.map((r) => ({
        id: r.id,
        question_text: r.questionText,
        options: r.options,
        correct_answer: r.correctAnswer,
        difficulty: r.difficulty,
        discipline: r.discipline,
        exam_board: r.examBoard,
        explanation: r.explanation,
        legislation_title: r.legislationTitle,
        legislation_link: r.legislationLink,
      }));

      setQuestions(mapped);
      setStatus('in-progress');
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer('');
      setTimeSpent(0);
      setTimer(0);
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + answers.length) / (questions.length || 1)) * 100;

  const handleNext = () => {
    if (!currentQuestion || !user) return;

    const correct = selectedAnswer === currentQuestion.correct_answer;
    const updated: Answer[] = [
      ...answers,
      {
        questionId: currentQuestion.id,
        userAnswer: selectedAnswer,
        correct,
        timeSpent,
      },
    ];
    setAnswers(updated);

    if (currentIndex + 1 >= questions.length) {
      setStatus('completed');
      // Persist the completed session + its answers.
      recordMutation.mutate({
        discipline: discipline !== '' ? discipline : 'Geral',
        difficulty: difficulty !== '' ? (difficulty as 'easy' | 'medium' | 'hard') : 'medium',
        answers: updated,
      });
    } else {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer('');
      setTimeSpent(0);
    }
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const accuracy = accuracyPct(correctCount, questions.length);

  // Not started state
  if (status === 'not-started') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setMode(null)}
            className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition"
          >
            Voltar aos modos
          </button>
        </div>

        <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-6 text-white">
          <h3 className="text-xl font-bold mb-2">Simulado Padrao</h3>
          <p className="text-white/80">
            Configure os filtros e comece a resolver questoes reais de provas anteriores.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Disciplina</label>
            <select
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
            >
              <option value="">Todas</option>
              {disciplineLov.options.map((o) => (
                <option key={o.code} value={o.code}>{o.value}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Banca</label>
            <select
              value={examBoard}
              onChange={(e) => setExamBoard(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
            >
              <option value="">Todas</option>
              {examBoardLov.options.map((o) => (
                <option key={o.code} value={o.code}>{o.value}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dificuldade</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-[#16161a]"
            >
              <option value="">Todas</option>
              {difficultyLov.options.map((o) => (
                <option key={o.code} value={o.code}>{o.value}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={loadQuestions}
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <BookOpen className="w-5 h-5" />
          {loading ? 'Carregando...' : 'Comecar Simulado'}
        </button>
      </div>
    );
  }

  // In progress state
  if (status === 'in-progress' && currentQuestion) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => {
              setMode(null);
              setStatus('not-started');
            }}
            className="text-sm text-[#16161a] hover:text-[#26262c] font-medium transition"
          >
            Voltar aos modos
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">
              Questao {currentIndex + 1} de {questions.length}
            </span>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-[#16161a] to-[#26262c] h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
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
            onClick={handleNext}
            disabled={!selectedAnswer}
            className="w-full bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {currentIndex + 1 === questions.length ? 'Finalizar' : 'Proxima'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Completed state
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#16161a] to-[#16161a] rounded-xl p-6 text-white">
        <h3 className="text-2xl font-bold mb-2">Simulado Finalizado!</h3>
        <p className="text-white/80">Seus resultados foram salvos com sucesso.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-[#16161a] mb-2">{accuracy}%</div>
          <p className="text-gray-600">Acuracia</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-green-600 mb-2 flex items-center justify-center gap-2">
            <CheckCircle className="w-8 h-8" />
            {correctCount}
          </div>
          <p className="text-gray-600">Acertos de {questions.length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow text-center">
          <div className="text-4xl font-bold text-red-600 mb-2 flex items-center justify-center gap-2">
            <XCircle className="w-8 h-8" />
            {questions.length - correctCount}
          </div>
          <p className="text-gray-600">Erros</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="text-lg font-bold text-[#16161a] mb-4">Resumo das Questoes</h4>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {questions.map((q, idx) => {
            const answer = answers[idx];
            return (
              <div
                key={q.id}
                className={`p-3 rounded-lg border-l-4 ${
                  answer?.correct ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">Questao {idx + 1}</p>
                    <p className="text-sm text-gray-600">{disciplineLov.labelOf(q.discipline)}</p>
                  </div>
                  {answer?.correct ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => {
            setStatus('not-started');
            setMode(null);
          }}
          className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Trocar Modo
        </button>
        <button
          onClick={() => setStatus('not-started')}
          className="flex-1 bg-gradient-to-r from-[#26262c] to-[#26262c] text-white py-3 rounded-lg font-semibold hover:shadow-lg transition"
        >
          Refazer Simulado
        </button>
      </div>
    </div>
  );
}
